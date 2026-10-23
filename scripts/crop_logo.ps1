Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path $PSScriptRoot "..\public\logo.png"
$src = [System.Drawing.Bitmap]::FromFile($srcPath)

# The circle is horizontally centered in 576 width, diameter ~ 576
# In 576 x 1024, the circle center Y is around 1024 / 2 = 512
# Let's inspect or crop a 576x576 square centered at Y = (1024 - 576) / 2 = 224
$size = 576
$cropY = [int]((1024 - $size) / 2) # 224
$cropX = 0

# Create a circular cropped bitmap with transparent background
$dest = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($dest)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddEllipse(0, 0, $size, $size)
$g.SetClip($path)

$rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$srcRect = New-Object System.Drawing.Rectangle $cropX, $cropY, $size, $size

$g.DrawImage($src, $rect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

$destPath = Join-Path $PSScriptRoot "..\public\logo-circle.png"
$dest.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$dest.Dispose()
$src.Dispose()

Write-Host "Logo successfully cropped to circle at $destPath"
