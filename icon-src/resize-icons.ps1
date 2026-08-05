# icon-logo-master.png から各サイズのアイコンを書き出す
Add-Type -AssemblyName System.Drawing

$src = "$PSScriptRoot\icon-logo-master.png"
$outDir = "$PSScriptRoot\..\site\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Resize-Icon($srcPath, $destPath, $size) {
    $srcImg = [System.Drawing.Image]::FromFile($srcPath)
    $dest = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($srcImg, 0, 0, $size, $size)
    $dest.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $dest.Dispose()
    $srcImg.Dispose()
}

Resize-Icon $src "$outDir\icon-32.png" 32
Resize-Icon $src "$outDir\icon-192.png" 192
Resize-Icon $src "$outDir\icon-512.png" 512
Resize-Icon $src "$outDir\apple-touch-icon.png" 180

Write-Host "Done: $outDir"
