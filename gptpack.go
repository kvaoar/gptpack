package main

import (
	"archive/zip"
	"bufio"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

type Config struct {
	OutputDir        string   `json:"outputDir"`
	SkipDirs         []string `json:"skipDirs"`
	SkipExt          []string `json:"skipExt"`
	SkipBinaryNoExt  bool     `json:"skipBinaryNoExt"`
	IgnoreFile       string   `json:"ignoreFile"`
}

func LoadConfig(path string) Config {
	var cfg Config
	data, err := os.ReadFile(path)
	if err != nil {
		cfg.OutputDir = `C:\gpt_upload`
		cfg.IgnoreFile = ".gptpackignore"
		return cfg
	}
	json.Unmarshal(data, &cfg)
	return cfg
}

func LoadIgnore(path string) map[string]bool {
	m := map[string]bool{}
	f, err := os.Open(path)
	if err != nil {
		return m
	}
	defer f.Close()

	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		m[line] = true
	}
	return m
}

type Filter struct {
	SkipDirs        map[string]bool
	SkipExt         map[string]bool
	IgnoreNames     map[string]bool
	SkipBinaryNoExt bool
}

func NewFilter(skipDirs, skipExt []string, skipBinary bool, ignore map[string]bool) Filter {
	f := Filter{
		SkipDirs:        map[string]bool{},
		SkipExt:         map[string]bool{},
		IgnoreNames:     ignore,
		SkipBinaryNoExt: skipBinary,
	}

	for _, d := range skipDirs {
		d = filepath.ToSlash(strings.Trim(d, `/\`))
		if d != "" {
			f.SkipDirs[d] = true
		}
	}

	for _, e := range skipExt {
		f.SkipExt[strings.ToLower(e)] = true
	}

	return f
}

func (f Filter) IsELF(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()

	buf := make([]byte, 4)
	n, _ := file.Read(buf)
	return n == 4 &&
		buf[0] == 0x7f &&
		buf[1] == 'E' &&
		buf[2] == 'L' &&
		buf[3] == 'F'
}

func (f Filter) IsBinary(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return true
	}
	if len(data) > 2048 {
		data = data[:2048]
	}
	for _, b := range data {
		if b == 0 {
			return true
		}
	}
	return false
}

func (f Filter) Accept(path string, info os.FileInfo, rel string) bool {
	rel = filepath.ToSlash(rel)

	for d := range f.SkipDirs {
		if rel == d || strings.HasPrefix(rel, d+"/") {
			return false
		}
	}

	ext := strings.ToLower(filepath.Ext(info.Name()))
	if f.SkipExt[ext] {
		return false
	}

	if ext == "" && f.SkipBinaryNoExt && f.IsBinary(path) {
		return false
	}

	if f.IsELF(path) {
		return false
	}

	if f.IgnoreNames[info.Name()] {
		return false
	}

	return true
}

type FileEntry struct {
	Path    string
	Rel     string
	Size    int64
	Hash    string
	Skipped bool
}

func CollectFiles(root string, flt Filter) []FileEntry {
	var out []FileEntry
	var mu sync.Mutex

	root = filepath.Clean(root)
	rootSlash := filepath.ToSlash(root)

	jobs := make(chan string, 4096)
	wg := sync.WaitGroup{}

	workers := runtime.NumCPU()
	if workers < 4 {
		workers = 4
	}

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range jobs {
				info, err := os.Stat(path)
				if err != nil || info.IsDir() {
					continue
				}

				abs := filepath.ToSlash(path)
				rel := strings.TrimPrefix(abs, rootSlash)
				rel = strings.TrimPrefix(rel, "/")

				if !flt.Accept(path, info, rel) {
					mu.Lock()
					out = append(out, FileEntry{
						Path:    path,
						Rel:     rel,
						Size:    info.Size(),
						Skipped: true,
					})
					mu.Unlock()
					continue
				}

				f, err := os.Open(path)
				if err != nil {
					continue
				}
				h := sha1.New()
				io.Copy(h, f)
				f.Close()

				mu.Lock()
				out = append(out, FileEntry{
					Path: path,
					Rel:  rel,
					Size: info.Size(),
					Hash: hex.EncodeToString(h.Sum(nil)),
				})
				mu.Unlock()
			}
		}()
	}

	filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err == nil {
			jobs <- path
		}
		return nil
	})

	close(jobs)
	wg.Wait()
	return out
}

func WriteZip(outPath, root string, files []FileEntry) error {
	out, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer out.Close()

	zw := zip.NewWriter(out)
	defer zw.Close()

	logEntry, _ := zw.Create("_gptpack_log.txt")

	logEntry.Write([]byte("=== INCLUDED ===\n"))
	for _, f := range files {
		if !f.Skipped {
			fmt.Fprintf(logEntry, "%s | %d | %s\n", f.Rel, f.Size, f.Hash)
		}
	}

	logEntry.Write([]byte("\n=== SKIPPED ===\n"))
	for _, f := range files {
		if f.Skipped {
			fmt.Fprintf(logEntry, "%s | %d | SKIPPED\n", f.Rel, f.Size)
		}
	}

	for _, f := range files {
		if f.Skipped {
			continue
		}
		w, err := zw.Create(f.Rel)
		if err != nil {
			return err
		}
		src, err := os.Open(f.Path)
		if err != nil {
			continue
		}
		io.Copy(w, src)
		src.Close()
	}

	return nil
}

func main() {
	if len(os.Args) < 2 {
		return
	}

	root := filepath.Clean(os.Args[1])
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return
	}

	exe, _ := os.Executable()
	exeDir := filepath.Dir(exe)

	cfg := LoadConfig(filepath.Join(exeDir, "gptpack.config.json"))

	ignore := LoadIgnore(filepath.Join(root, cfg.IgnoreFile))
	flt := NewFilter(cfg.SkipDirs, cfg.SkipExt, cfg.SkipBinaryNoExt, ignore)

	files := CollectFiles(root, flt)

	os.MkdirAll(cfg.OutputDir, 0755)

	outzip := filepath.Join(cfg.OutputDir, filepath.Base(root)+".zip")
	WriteZip(outzip, root, files)
}
