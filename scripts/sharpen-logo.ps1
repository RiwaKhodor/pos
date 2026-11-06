Add-Type -AssemblyName System.Drawing
$srcPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\public\logo.png"))
$loaded = [System.Drawing.Image]::FromFile($srcPath)
$target = 768
$out = New-Object System.Drawing.Bitmap $target, $target, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.Clear([System.Drawing.Color]::Transparent)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.DrawImage($loaded, 0, 0, $target, $target)
$g.Dispose()
$loaded.Dispose()

$contrast = 1.08
$shift = (1.0 - $contrast) / 2.0
$matrix = New-Object System.Drawing.Imaging.ColorMatrix
$matrix.Matrix00 = $contrast
$matrix.Matrix11 = $contrast
$matrix.Matrix22 = $contrast
$matrix.Matrix33 = 1
$matrix.Matrix40 = $shift
$matrix.Matrix41 = $shift
$matrix.Matrix42 = $shift
$attrs = New-Object System.Drawing.Imaging.ImageAttributes
$attrs.SetColorMatrix($matrix)

$final = New-Object System.Drawing.Bitmap $target, $target, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$fg = [System.Drawing.Graphics]::FromImage($final)
$fg.Clear([System.Drawing.Color]::Transparent)
$fg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$fg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$rect = New-Object System.Drawing.Rectangle 0, 0, $target, $target
$fg.DrawImage($out, $rect, 0, 0, $target, $target, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
$fg.Dispose()
$attrs.Dispose()
$out.Dispose()

$icon = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\src\app\icon.png"))
$final.Save($srcPath, [System.Drawing.Imaging.ImageFormat]::Png)
$final.Save($icon, [System.Drawing.Imaging.ImageFormat]::Png)
$final.Dispose()
Write-Output "saved $target x $target"
