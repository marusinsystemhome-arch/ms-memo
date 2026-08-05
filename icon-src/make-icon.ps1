# MSメモ アプリアイコン生成スクリプト
# 朝焼け(モーニングセミナーの「朝」)を背景に、白いメモ帳シルエットを配置したオリジナルアイコン。
# ソースロゴが無いためゼロから描画する。

Add-Type -AssemblyName System.Drawing

$S = 1200
$bmp = New-Object System.Drawing.Bitmap($S, $S)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

function New-Color($hex) {
    return [System.Drawing.ColorTranslator]::FromHtml($hex)
}

# --- 背景: 朝焼けグラデーション(紺 -> オレンジ) ---
$navy = New-Color "#1B2A4A"
$orange = New-Color "#FF9E4A"
$rectFull = New-Object System.Drawing.Rectangle(0, 0, $S, $S)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rectFull, $navy, $orange, 90.0)
$g.FillRectangle($bgBrush, $rectFull)

# --- 太陽(半円、地平線に沈みかけの朝日) ---
$sunColor = New-Color "#FFE8B0"
$sunBrush = New-Object System.Drawing.SolidBrush($sunColor)
$sunR = 260
$sunCx = $S / 2
$sunCy = $S * 0.60
$g.FillEllipse($sunBrush, [float]($sunCx - $sunR), [float]($sunCy - $sunR), [float]($sunR*2), [float]($sunR*2))

# 地平線より下を背景色で覆って半円状に見せる
$horizonY = $S * 0.60
$maskBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rectFull, $navy, $orange, 90.0)
$g.FillRectangle($maskBrush, 0, [float]$horizonY, $S, [float]($S - $horizonY))

# --- 地平線ライン ---
$linePen = New-Object System.Drawing.Pen((New-Color "#2B3A67"), 10)
$g.DrawLine($linePen, 0, [float]$horizonY, $S, [float]$horizonY)

# --- メモ帳シルエット(中央やや下、白) ---
$padW = 620
$padH = 520
$padX = ($S - $padW) / 2
$padY = $S * 0.42
$padColor = [System.Drawing.Color]::White
$padBrush = New-Object System.Drawing.SolidBrush($padColor)

# 影(奥行き用に薄いグレーで少しずらして四角)
$shadowBrush = New-Object System.Drawing.SolidBrush((New-Color "#00000022"))
$shadowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 40
$sx = $padX + 18
$sy = $padY + 18
$shadowPath.AddArc($sx, $sy, $r*2, $r*2, 180, 90)
$shadowPath.AddArc($sx+$padW-$r*2, $sy, $r*2, $r*2, 270, 90)
$shadowPath.AddArc($sx+$padW-$r*2, $sy+$padH-$r*2, $r*2, $r*2, 0, 90)
$shadowPath.AddArc($sx, $sy+$padH-$r*2, $r*2, $r*2, 90, 90)
$shadowPath.CloseFigure()
$g.FillPath($shadowBrush, $shadowPath)

$padPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$padPath.AddArc($padX, $padY, $r*2, $r*2, 180, 90)
$padPath.AddArc($padX+$padW-$r*2, $padY, $r*2, $r*2, 270, 90)
$padPath.AddArc($padX+$padW-$r*2, $padY+$padH-$r*2, $r*2, $r*2, 0, 90)
$padPath.AddArc($padX, $padY+$padH-$r*2, $r*2, $r*2, 90, 90)
$padPath.CloseFigure()
$g.FillPath($padBrush, $padPath)

# メモ帳の折れ耳(右上ドッグイヤー)
$earSize = 110
$earBrush = New-Object System.Drawing.SolidBrush((New-Color "#E8E4DA"))
$g.FillPolygon($earBrush, @(
    (New-Object System.Drawing.PointF(($padX+$padW-$earSize), $padY)),
    (New-Object System.Drawing.PointF(($padX+$padW), $padY)),
    (New-Object System.Drawing.PointF(($padX+$padW), ($padY+$earSize)))
))

# メモの罫線(3本)
$linePen2 = New-Object System.Drawing.Pen((New-Color "#FF9E4A"), 22)
$linePen2.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$linePen2.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$lineMarginX = 90
$lineY1 = $padY + 170
$lineY2 = $padY + 260
$lineY3 = $padY + 350
$g.DrawLine($linePen2, $padX+$lineMarginX, $lineY1, $padX+$padW-$lineMarginX, $lineY1)
$g.DrawLine($linePen2, $padX+$lineMarginX, $lineY2, $padX+$padW-$lineMarginX-140, $lineY2)
$g.DrawLine($linePen2, $padX+$lineMarginX, $lineY3, $padX+$padW-$lineMarginX-260, $lineY3)

# --- 小さなマイク(録音メモを示すアイコン、右下に配置) ---
$micColor = New-Color "#1B2A4A"
$micBrush = New-Object System.Drawing.SolidBrush($micColor)
$micPen = New-Object System.Drawing.Pen($micColor, 16)
$micPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$micPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

$micCx = $padX + $padW - 130
$micBodyTopY = $padY + $padH - 230
$micBodyW = 70
$micBodyH = 130
$g.FillPath($micBrush, $(
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($micCx-$micBodyW/2, $micBodyTopY, $micBodyW, $micBodyW, 180, 180)
    $p.AddLine($micCx+$micBodyW/2, $micBodyTopY+$micBodyW/2, $micCx+$micBodyW/2, $micBodyTopY+$micBodyH-$micBodyW/2)
    $p.AddArc($micCx-$micBodyW/2, $micBodyTopY+$micBodyH-$micBodyW, $micBodyW, $micBodyW, 0, 180)
    $p.CloseFigure()
    $p
))

# マイクスタンド(弧)
$standR = 60
$g.DrawArc($micPen, $micCx-$standR, $micBodyTopY+$micBodyH-$standR+10, $standR*2, $standR*2, 20, 140)
# マイク支柱と台座
$g.DrawLine($micPen, $micCx, $micBodyTopY+$micBodyH+$standR-8, $micCx, $micBodyTopY+$micBodyH+$standR+50)
$g.DrawLine($micPen, $micCx-45, $micBodyTopY+$micBodyH+$standR+50, $micCx+45, $micBodyTopY+$micBodyH+$standR+50)

$bmp.Save("$PSScriptRoot\icon-logo-master.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "Saved: $PSScriptRoot\icon-logo-master.png"
