$svg="chatgpt.svg"
foreach($s in 16,32,48,64,128,256){
    inkscape $svg `
        --export-type=png `
        --export-filename="icon_$s.png" `
        --export-width=$s `
        --export-height=$s `
        --export-background-opacity=0
}
