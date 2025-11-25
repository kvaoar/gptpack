package main

import (
	"os"
	"path/filepath"
	"testing"
)

func must(t *testing.T, err error) {
	if err != nil {
		t.Fatalf("err: %v", err)
	}
}

func writeFile(t *testing.T, p, s string) {
	must(t, os.MkdirAll(filepath.Dir(p), 0755))
	must(t, os.WriteFile(p, []byte(s), 0644))
}

//
// -------------------- LoadConfig --------------------
//
func TestLoadConfig(t *testing.T) {
	cfg := LoadConfig("no_file.json")

	if cfg.OutputDir != "C:\\gpt_upload" {
		t.Fatalf("expected fallback outputDir, got %s", cfg.OutputDir)
	}
	if cfg.IgnoreFile != ".gptpackignore" {
		t.Fatalf("expected fallback ignoreFile, got %s", cfg.IgnoreFile)
	}
}

//
// -------------------- FilterAccept --------------------
//

func TestFilterAccept(t *testing.T) {
	tmp := t.TempDir()

	cfg := Config{
		SkipDirs:        []string{"build"},
		SkipExt:         []string{".exe"},
		SkipBinaryNoExt: true,
		IgnoreFile:      ".gptpackignore",
	}

	flt := NewFilter(cfg.SkipDirs, cfg.SkipExt, cfg.SkipBinaryNoExt, map[string]bool{})

	// dir itself skipped
	dir := filepath.Join(tmp, "build")
	must(t, os.Mkdir(dir, 0755))
	info0, _ := os.Stat(dir)
	if flt.Accept(dir, info0, "build") {
		t.Fatalf("build dir must be skipped")
	}

	// file inside build skipped
	f1 := filepath.Join(tmp, "build", "a.txt")
	writeFile(t, f1, "hello")
	info1, _ := os.Stat(f1)
	if flt.Accept(f1, info1, "build/a.txt") {
		t.Fatalf("file inside skipped directory must also be skipped")
	}

	// extension skip
	f2 := filepath.Join(tmp, "x.exe")
	writeFile(t, f2, "xxx")
	info2, _ := os.Stat(f2)
	if flt.Accept(f2, info2, "x.exe") {
		t.Fatalf("exe must be skipped")
	}

	// binary no ext skip
	f3 := filepath.Join(tmp, "binfile")
	writeFile(t, f3, string([]byte{0, 1, 2}))
	info3, _ := os.Stat(f3)
	if flt.Accept(f3, info3, "binfile") {
		t.Fatalf("binary file without ext must be skipped")
	}
}

//
// -------------------- CollectFiles --------------------
//

func TestCollectFiles(t *testing.T) {
	tmp := t.TempDir()

	writeFile(t, filepath.Join(tmp, "build", "a.txt"), "hello")
	writeFile(t, filepath.Join(tmp, "test.go"), "package main")
	writeFile(t, filepath.Join(tmp, "binfile"), string([]byte{0, 1, 2}))

	cfg := Config{
		SkipDirs:        []string{"build"},
		SkipExt:         []string{},
		SkipBinaryNoExt: true,
		IgnoreFile:      ".gptpackignore",
	}

	flt := NewFilter(cfg.SkipDirs, cfg.SkipExt, cfg.SkipBinaryNoExt, map[string]bool{})

	files := CollectFiles(tmp, flt)

	var sawBuild, skipBuild bool
	var sawTest, skipTest bool
	var sawBin, skipBin bool

	for _, f := range files {
		switch filepath.Base(f.Path) {
		case "a.txt":
			sawBuild = true
			skipBuild = f.Skipped
		case "test.go":
			sawTest = true
			skipTest = f.Skipped
		case "binfile":
			sawBin = true
			skipBin = f.Skipped
		}
	}

	// build/a.txt → MUST be skipped
	if !sawBuild || !skipBuild {
		t.Fatalf("build/a.txt must be skipped")
	}

	// test.go → included
	if !sawTest || skipTest {
		t.Fatalf("test.go must be included")
	}

	// binfile → skipped
	if !sawBin || !skipBin {
		t.Fatalf("binfile must be skipped")
	}
}
