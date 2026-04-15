Add-Type -AssemblyName System.Drawing
$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Warm orange gradient circle (friendly, visible).
$rect = New-Object System.Drawing.Rectangle(16, 16, ($size-32), ($size-32))
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 255, 149, 0),
  [System.Drawing.Color]::FromArgb(255, 232, 74, 74),
  45.0
)
$g.FillEllipse($brush, $rect)

# Big white question mark.
$font = New-Object System.Drawing.Font("Segoe UI", 280, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF(0, 14, $size, $size)
$g.DrawString("?", $font, [System.Drawing.Brushes]::White, $textRect, $sf)

$g.Dispose()
$out = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\assets\icon.png"
$bmp.Save((Resolve-Path -LiteralPath (Split-Path -Parent $out)).ProviderPath + "\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "wrote icon.png"
