Add-Type -AssemblyName System.Drawing
$src = Join-Path $PSScriptRoot "..\public\logo.png"
$src = [System.IO.Path]::GetFullPath($src)
$loaded = [System.Drawing.Bitmap]::FromFile($src)
$w = $loaded.Width
$h = $loaded.Height
$img = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$copy = [System.Drawing.Graphics]::FromImage($img)
$copy.DrawImage($loaded, 0, 0, $w, $h)
$copy.Dispose()
$loaded.Dispose()

$visited = New-Object "bool[,]" $w, $h
$q = New-Object System.Collections.Generic.Queue[object]
function TryAdd([int]$x, [int]$y) {
  if ($x -lt 0 -or $y -lt 0 -or $x -ge $script:w -or $y -ge $script:h) { return }
  if ($script:visited.Get($x, $y)) { return }
  $c = $script:img.GetPixel($x, $y)
  if ($c.A -gt 0 -and $c.R -lt 48 -and $c.G -lt 48 -and $c.B -lt 48) {
    $script:visited.Set($x, $y, $true)
    $script:q.Enqueue(@($x, $y))
  }
}
$script:w = $w; $script:h = $h; $script:img = $img; $script:visited = $visited; $script:q = $q
for ($x = 0; $x -lt $w; $x++) { TryAdd $x 0; TryAdd $x ($h - 1) }
for ($y = 0; $y -lt $h; $y++) { TryAdd 0 $y; TryAdd ($w - 1) $y }
while ($q.Count -gt 0) {
  $p = $q.Dequeue()
  $x = [int]$p[0]; $y = [int]$p[1]
  $img.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
  TryAdd ($x - 1) $y; TryAdd ($x + 1) $y; TryAdd $x ($y - 1); TryAdd $x ($y + 1)
}

$minX = $w; $minY = $h; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    if ($img.GetPixel($x, $y).A -gt 12) {
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
$cw = $maxX - $minX + 1
$ch = $maxY - $minY + 1
$size = [Math]::Max($cw, $ch)
$pad = 2
$outSize = $size + ($pad * 2)
$out = New-Object System.Drawing.Bitmap $outSize, $outSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$og = [System.Drawing.Graphics]::FromImage($out)
$og.Clear([System.Drawing.Color]::Transparent)
$og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$dx = $pad + [int](($size - $cw) / 2)
$dy = $pad + [int](($size - $ch) / 2)
$og.DrawImage($img, [System.Drawing.Rectangle]::new($dx, $dy, $cw, $ch), [System.Drawing.Rectangle]::new($minX, $minY, $cw, $ch), [System.Drawing.GraphicsUnit]::Pixel)
$og.Dispose()
$img.Dispose()

$cx = ($outSize - 1) / 2.0
$cy = ($outSize - 1) / 2.0
$r = ($outSize / 2.0) - 0.5
for ($y = 0; $y -lt $outSize; $y++) {
  for ($x = 0; $x -lt $outSize; $x++) {
    $d = [Math]::Sqrt(($x - $cx) * ($x - $cx) + ($y - $cy) * ($y - $cy))
    if ($d -gt $r) {
      $out.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    } elseif ($d -gt ($r - 1.25)) {
      $c = $out.GetPixel($x, $y)
      $fade = $r - $d
      $a = [int][Math]::Max(0, [Math]::Min(255, $c.A * $fade))
      $out.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($a, $c.R, $c.G, $c.B))
    }
  }
}

$dest = Join-Path $PSScriptRoot "..\public\logo.png"
$dest = [System.IO.Path]::GetFullPath($dest)
$icon = Join-Path $PSScriptRoot "..\src\app\icon.png"
$icon = [System.IO.Path]::GetFullPath($icon)
$out.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
$out.Save($icon, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "saved $dest size=${outSize}x${outSize}"
$out.Dispose()
