param(
  [Parameter(Mandatory = $true)][string]$JsonPath,
  [string]$LogoPath = "",
  [string]$PdfPath = ""
)

$ErrorActionPreference = "Stop"

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne "STA") {
  $argList = @(
    "-STA", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", $PSCommandPath,
    "-JsonPath", $JsonPath
  )
  if ($LogoPath) { $argList += @("-LogoPath", $LogoPath) }
  if ($PdfPath) { $argList += @("-PdfPath", $PdfPath) }
  $p = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Wait -PassThru -WindowStyle Hidden
  exit $p.ExitCode
}

Add-Type -AssemblyName System.Drawing

$receipt = Get-Content -Raw -Encoding UTF8 $JsonPath | ConvertFrom-Json
$items = @($receipt.items)

function Get-PosPrinterName {
  $virtual = "PDF|XPS|OneNote|Fax"
  $label = "Label|XP-365|365B"
  $printers = @(Get-CimInstance Win32_Printer)
  $pos = $printers | Where-Object { $_.Name -eq "POS-80" } | Select-Object -First 1
  if ($pos) {
    return $pos.Name
  }
  $thermal = $printers | Where-Object { $_.Name -match "Thermal|Receipt" -and $_.Name -notmatch $label } | Select-Object -First 1
  if ($thermal) {
    return $thermal.Name
  }
  $default = $printers | Where-Object { $_.Default -and $_.Name -notmatch $label } | Select-Object -First 1
  if ($default -and $default.Name -notmatch $virtual) {
    return $default.Name
  }
  $real = @($printers | Where-Object { $_.Name -notmatch $virtual -and $_.Name -notmatch $label })
  if ($real.Count -gt 0) {
    return $real[0].Name
  }
  $pdf = $printers | Where-Object { $_.Name -eq "Microsoft Print to PDF" }
  if ($pdf -and $PdfPath) {
    return $pdf.Name
  }
  throw "NO_PRINTER"
}

$printerName = Get-PosPrinterName
$printToFile = $printerName -eq "Microsoft Print to PDF"

if ($printToFile) {
  if (-not $PdfPath) { throw "NO_PDF_PATH" }
  $dir = Split-Path -Parent $PdfPath
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
}

$script:logoPath = $LogoPath
$script:receipt = $receipt
$script:items = $items

if (-not ("RawPrinter" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool StartDocPrinter(IntPtr h, int level, DocInfo di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    DocInfo di = new DocInfo();
    di.pDocName = "VANO receipt";
    di.pDataType = "RAW";
    if (!StartDocPrinter(h, 1, di)) { int e = Marshal.GetLastWin32Error(); ClosePrinter(h); throw new System.ComponentModel.Win32Exception(e); }
    StartPagePrinter(h);
    int written;
    bool ok = WritePrinter(h, bytes, bytes.Length, out written);
    int err = Marshal.GetLastWin32Error();
    EndPagePrinter(h);
    EndDocPrinter(h);
    ClosePrinter(h);
    if (!ok) throw new System.ComponentModel.Win32Exception(err);
  }
}
"@
}

function Send-EscPosImage([string]$Printer, [System.Drawing.Image]$Source) {
  $targetW = 576
  $targetH = [Math]::Max(1, [int]($Source.Height * ($targetW / [double]$Source.Width)))
  $bmp = New-Object System.Drawing.Bitmap $targetW, $targetH, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.DrawImage($Source, 0, 0, $targetW, $targetH)
  $g.Dispose()

  $lastRow = 0
  for ($y = $targetH - 1; $y -ge 0; $y--) {
    $hit = $false
    for ($x = 0; $x -lt $targetW; $x += 6) {
      $c = $bmp.GetPixel($x, $y)
      if ($c.R -lt 245 -or $c.G -lt 245 -or $c.B -lt 245) { $hit = $true; break }
    }
    if ($hit) { $lastRow = $y; break }
  }
  $targetH = [Math]::Min($bmp.Height, $lastRow + 40)
  $trimmed = $bmp.Clone(
    (New-Object System.Drawing.Rectangle 0, 0, $targetW, $targetH),
    $bmp.PixelFormat
  )
  $bmp.Dispose()
  $bmp = $trimmed

  $rect = New-Object System.Drawing.Rectangle 0, 0, $targetW, $targetH
  $bits = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $bmp.PixelFormat)
  $stride = $bits.Stride
  $raw = New-Object byte[] ($stride * $targetH)
  [System.Runtime.InteropServices.Marshal]::Copy($bits.Scan0, $raw, 0, $raw.Length)
  $bmp.UnlockBits($bits)
  $bmp.Dispose()

  $bytesPerRow = [int]($targetW / 8)
  $ms = New-Object System.IO.MemoryStream
  # Darker heat, then the picture. 576 dots is the printer's real width.
  $ms.Write(@(0x1B, 0x40, 0x1B, 0x37, 0x07, 0xC8, 0x02), 0, 7)
  $strip = 128
  for ($y0 = 0; $y0 -lt $targetH; $y0 += $strip) {
    $rows = [Math]::Min($strip, $targetH - $y0)
    $header = [byte[]]@(
      0x1D, 0x76, 0x30, 0x00,
      ($bytesPerRow -band 0xFF), ([int]($bytesPerRow / 256) -band 0xFF),
      ($rows -band 0xFF), ([int]($rows / 256) -band 0xFF)
    )
    $ms.Write($header, 0, $header.Length)
    for ($y = $y0; $y -lt ($y0 + $rows); $y++) {
      $row = New-Object byte[] $bytesPerRow
      for ($x = 0; $x -lt $targetW; $x++) {
        $i = ($y * $stride) + ($x * 4)
        $lum = (0.114 * $raw[$i]) + (0.587 * $raw[$i + 1]) + (0.299 * $raw[$i + 2])
        if ($lum -lt 230) {
          $row[[int]($x / 8)] = $row[[int]($x / 8)] -bor (1 -shl (7 - ($x % 8)))
        }
      }
      $ms.Write($row, 0, $row.Length)
    }
  }
  $ms.Write(@(0x1B, 0x64, 0x04, 0x1D, 0x56, 0x00), 0, 6)
  [RawPrinter]::Send($Printer, $ms.ToArray())
  $ms.Dispose()
}

function Add-EscText([System.IO.MemoryStream]$Stream, [string]$Text) {
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($Text + "`r`n")
  $Stream.Write($bytes, 0, $bytes.Length)
}

function Add-EscPosBitmap([System.IO.MemoryStream]$Stream, [System.Drawing.Bitmap]$Bitmap) {
  $w = $Bitmap.Width
  $h = $Bitmap.Height
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $bits = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $bits.Stride
  $raw = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($bits.Scan0, $raw, 0, $raw.Length)
  $Bitmap.UnlockBits($bits)
  $bytesPerRow = [int]($w / 8)
  $strip = 48
  for ($y0 = 0; $y0 -lt $h; $y0 += $strip) {
    $rows = [Math]::Min($strip, $h - $y0)
    $header = [byte[]]@(
      0x1D, 0x76, 0x30, 0x00,
      ($bytesPerRow -band 0xFF), ([int]($bytesPerRow / 256) -band 0xFF),
      ($rows -band 0xFF), ([int]($rows / 256) -band 0xFF)
    )
    $Stream.Write($header, 0, $header.Length)
    for ($y = $y0; $y -lt ($y0 + $rows); $y++) {
      $row = New-Object byte[] $bytesPerRow
      for ($x = 0; $x -lt $w; $x++) {
        $i = ($y * $stride) + ($x * 4)
        $lum = (0.114 * $raw[$i]) + (0.587 * $raw[$i + 1]) + (0.299 * $raw[$i + 2])
        if ($lum -lt 210) {
          $row[[int]($x / 8)] = [byte]($row[[int]($x / 8)] -bor (1 -shl (7 - ($x % 8))))
        }
      }
      $Stream.Write($row, 0, $row.Length)
    }
  }
}

function New-ArabicLineBitmap([string]$Text) {
  $w = 576
  $h = 52
  $scale = 4
  $bigW = $w * $scale
  $bigH = $h * $scale
  $big = New-Object System.Drawing.Bitmap $bigW, $bigH, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($big)
  $g.Clear([System.Drawing.Color]::White)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $font = New-Object System.Drawing.Font("Traditional Arabic", (34 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString($Text, $font, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.RectangleF(0, 0, $bigW, $bigH)), $format)
  $font.Dispose()
  $g.Dispose()

  $rect = New-Object System.Drawing.Rectangle 0, 0, $bigW, $bigH
  $bits = $big.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $big.PixelFormat)
  $stride = $bits.Stride
  $raw = New-Object byte[] ($stride * $bigH)
  [System.Runtime.InteropServices.Marshal]::Copy($bits.Scan0, $raw, 0, $raw.Length)
  $big.UnlockBits($bits)
  $big.Dispose()

  $dark = New-Object "bool[,]" $w, $h
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $min = 255.0
      for ($dy = 0; $dy -lt $scale; $dy++) {
        for ($dx = 0; $dx -lt $scale; $dx++) {
          $i = ((($y * $scale) + $dy) * $stride) + ((($x * $scale) + $dx) * 4)
          $lum = (0.114 * $raw[$i]) + (0.587 * $raw[$i + 1]) + (0.299 * $raw[$i + 2])
          if ($lum -lt $min) { $min = $lum }
        }
      }
      $dark[$x, $y] = ($min -lt 200)
    }
  }

  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $on = $dark[$x, $y] -or ($x -gt 0 -and $dark[($x - 1), $y])
      $color = if ($on) { [System.Drawing.Color]::Black } else { [System.Drawing.Color]::White }
      $bmp.SetPixel($x, $y, $color)
    }
  }
  return $bmp
}

function Send-EscPosReceipt([string]$Printer) {
  $r = $script:receipt
  $ms = New-Object System.IO.MemoryStream
  # Leave Chinese mode, then kick the cash drawer (pin 2, then pin 5).
  $ms.Write([byte[]](0x1B, 0x40, 0x1C, 0x2E, 0x1B, 0x74, 0x00, 0x1B, 0x52, 0x00), 0, 10)
  $ms.Write([byte[]](0x1B, 0x70, 0x00, 0x19, 0xFA), 0, 5)
  $ms.Write([byte[]](0x1B, 0x70, 0x01, 0x19, 0xFA), 0, 5)
  $ms.Write([byte[]](0x1B, 0x61, 0x01, 0x1B, 0x21, 0x30), 0, 6)
  Add-EscText $ms ([string]$r.storeName)
  $ms.Write([byte[]](0x1B, 0x21, 0x00), 0, 3)
  if ($r.location) { Add-EscText $ms ([string]$r.location) }
  if ($r.address) { Add-EscText $ms ([string]$r.address) }
  if ($r.phone) { Add-EscText $ms ([string]$r.phone) }
  $ms.Write([byte[]](0x1B, 0x61, 0x00), 0, 3)
  Add-EscText $ms ""
  Add-EscText $ms ("Receipt: " + $r.receiptNumber)
  Add-EscText $ms ("Date: " + $r.date)
  Add-EscText $ms ("Cashier: " + $r.cashier)
  Add-EscText $ms ("Payment: " + $r.payment)
  Add-EscText $ms ("Pricing: " + $r.pricing)
  Add-EscText $ms "--------------------------------"
  Add-EscText $ms "Item                 Qty   Total"
  foreach ($item in @($script:items)) {
    $name = [string]$item.name
    if ($name.Length -gt 18) { $name = $name.Substring(0, 18) }
    $line = $name.PadRight(18) + ([string]$item.qty).PadLeft(5) + ([string]$item.total).PadLeft(9)
    Add-EscText $ms $line
    if ($item.each) { Add-EscText $ms ("  " + [string]$item.each) }
  }
  Add-EscText $ms "--------------------------------"
  Add-EscText $ms ("Subtotal".PadRight(16) + [string]$r.subtotal)
  if ($r.discount) { Add-EscText $ms ("Discount".PadRight(16) + [string]$r.discount) }
  if ($r.tax) { Add-EscText $ms ("Tax".PadRight(16) + [string]$r.tax) }
  $ms.Write([byte[]](0x1B, 0x45, 0x01), 0, 3)
  Add-EscText $ms ("Total $".PadRight(16) + [string]$r.totalUsd)
  Add-EscText $ms ("Total L.L".PadRight(16) + [string]$r.totalLbp)
  $ms.Write([byte[]](0x1B, 0x45, 0x00), 0, 3)
  Add-EscText $ms ("Rate".PadRight(16) + [string]$r.rate)
  if ($r.amountReceived) {
    Add-EscText $ms "--------------------------------"
    Add-EscText $ms ("Paid in".PadRight(16) + [string]$r.paidIn)
    Add-EscText $ms ("Received".PadRight(16) + [string]$r.amountReceived)
    Add-EscText $ms ("Change $".PadRight(16) + [string]$r.changeUsd)
    Add-EscText $ms ("Change L.L".PadRight(16) + [string]$r.changeLbp)
    Add-EscText $ms ("Change in".PadRight(16) + [string]$r.changeIn)
  }
  if ($r.footer) {
    $ms.Write([byte[]](0x1B, 0x61, 0x01), 0, 3)
    Add-EscText $ms ""
    Add-EscText $ms ([string]$r.footer)
  }
  $ms.Write([byte[]](0x1B, 0x64, 0x04, 0x1D, 0x56, 0x00), 0, 6)
  [RawPrinter]::Send($Printer, $ms.ToArray())
  $ms.Dispose()
}

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $printerName
$doc.DocumentName = ("VANO " + [string]$receipt.receiptNumber)
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(30, 30, 30, 30)

if ($printToFile) {
  $doc.PrinterSettings.PrintToFile = $true
  $doc.PrinterSettings.PrintFileName = $PdfPath
}

try {
  $custom = New-Object System.Drawing.Printing.PaperSize("Receipt80", 315, 1400)
  $doc.DefaultPageSettings.PaperSize = $custom
} catch {
}

$doc.add_PrintPage({
  param($sender, $e)
  $g = $e.Graphics
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $left = [float]$e.MarginBounds.Left
  $width = [float]$e.MarginBounds.Width
  $y = [float]$e.MarginBounds.Top
  $brush = [System.Drawing.Brushes]::Black
  $center = New-Object System.Drawing.StringFormat
  $center.Alignment = [System.Drawing.StringAlignment]::Center
  $right = New-Object System.Drawing.StringFormat
  $right.Alignment = [System.Drawing.StringAlignment]::Far

  $titleFont = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
  $font = New-Object System.Drawing.Font("Segoe UI", 8)
  $small = New-Object System.Drawing.Font("Segoe UI", 7)
  $bold = New-Object System.Drawing.Font("Segoe UI", 8, [System.Drawing.FontStyle]::Bold)

  $storeRect = New-Object System.Drawing.RectangleF($left, $y, $width, 20)
  $g.DrawString([string]$script:receipt.storeName, $titleFont, $brush, $storeRect, $center)
  $y += 20

  if ($script:receipt.location) {
    $arabic = New-Object System.Drawing.StringFormat
    $arabic.Alignment = [System.Drawing.StringAlignment]::Center
    $arabic.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft
    $locFont = New-Object System.Drawing.Font("Tahoma", 8)
    $g.DrawString([string]$script:receipt.location, $locFont, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 16)), $arabic)
    $locFont.Dispose()
    $y += 16
  }

  if ($script:receipt.address) {
    $g.DrawString([string]$script:receipt.address, $small, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 14)), $center)
    $y += 14
  }
  if ($script:receipt.phone) {
    $g.DrawString([string]$script:receipt.phone, $small, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 14)), $center)
    $y += 14
  }

  $y += 6
  $meta = @(
    ("Receipt: " + $script:receipt.receiptNumber),
    ("Date: " + $script:receipt.date),
    ("Cashier: " + $script:receipt.cashier),
    ("Payment: " + $script:receipt.payment),
    ("Pricing: " + $script:receipt.pricing)
  )
  foreach ($line in $meta) {
    $g.DrawString($line, $font, $brush, $left, $y)
    $y += 13
  }

  $y += 6
  $g.DrawLine([System.Drawing.Pens]::Black, $left, $y, $left + $width, $y)
  $y += 4
  $colQty = 36
  $colAmt = 70
  $nameW = $width - $colQty - $colAmt
  $g.DrawString("Item", $bold, $brush, $left, $y)
  $g.DrawString("Qty", $bold, $brush, (New-Object System.Drawing.RectangleF(($left + $nameW), $y, $colQty, 14)), $center)
  $g.DrawString("Total", $bold, $brush, (New-Object System.Drawing.RectangleF(($left + $nameW + $colQty), $y, $colAmt, 14)), $right)
  $y += 14
  $g.DrawLine([System.Drawing.Pens]::Black, $left, $y, $left + $width, $y)
  $y += 4

  foreach ($item in $script:items) {
    $g.DrawString([string]$item.name, $font, $brush, (New-Object System.Drawing.RectangleF($left, $y, $nameW, 14)))
    $g.DrawString([string]$item.qty, $font, $brush, (New-Object System.Drawing.RectangleF(($left + $nameW), $y, $colQty, 14)), $center)
    $g.DrawString([string]$item.total, $font, $brush, (New-Object System.Drawing.RectangleF(($left + $nameW + $colQty), $y, $colAmt, 14)), $right)
    $y += 13
    if ($item.each) {
      $g.DrawString([string]$item.each, $small, $brush, $left, $y)
      $y += 12
    }
  }

  $y += 4
  $g.DrawLine([System.Drawing.Pens]::Black, $left, $y, $left + $width, $y)
  $y += 6

  $rows = New-Object System.Collections.Generic.List[object]
  $rows.Add(@{ Label = "Subtotal"; Value = $script:receipt.subtotal; Bold = $false }) | Out-Null
  if ($script:receipt.discount) {
    $rows.Add(@{ Label = "Discount"; Value = $script:receipt.discount; Bold = $false }) | Out-Null
  }
  if ($script:receipt.tax) {
    $rows.Add(@{ Label = "Tax"; Value = $script:receipt.tax; Bold = $false }) | Out-Null
  }
  $rows.Add(@{ Label = "Total $"; Value = $script:receipt.totalUsd; Bold = $true }) | Out-Null
  $rows.Add(@{ Label = "Total L.L"; Value = $script:receipt.totalLbp; Bold = $true }) | Out-Null
  $rows.Add(@{ Label = "Rate"; Value = $script:receipt.rate; Bold = $false }) | Out-Null
  foreach ($row in $rows) {
    $f = if ($row.Bold) { $bold } else { $font }
    $g.DrawString([string]$row.Label, $f, $brush, $left, $y)
    $g.DrawString([string]$row.Value, $f, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 14)), $right)
    $y += 14
  }

  if ($script:receipt.amountReceived) {
    $y += 4
    $g.DrawLine([System.Drawing.Pens]::Black, $left, $y, $left + $width, $y)
    $y += 6
    $payRows = @(
      @{ Label = "Paid in"; Value = $script:receipt.paidIn; Bold = $false },
      @{ Label = "Amount received"; Value = $script:receipt.amountReceived; Bold = $false },
      @{ Label = "Change $"; Value = $script:receipt.changeUsd; Bold = $true },
      @{ Label = "Change L.L"; Value = $script:receipt.changeLbp; Bold = $true },
      @{ Label = "Change given in"; Value = $script:receipt.changeIn; Bold = $false }
    )
    foreach ($row in $payRows) {
      $f = if ($row.Bold) { $bold } else { $font }
      $g.DrawString([string]$row.Label, $f, $brush, $left, $y)
      $g.DrawString([string]$row.Value, $f, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 14)), $right)
      $y += 14
    }
  }

  if ($script:receipt.footer) {
    $y += 10
    $g.DrawString([string]$script:receipt.footer, $small, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 28)), $center)
  }

  $titleFont.Dispose()
  $font.Dispose()
  $small.Dispose()
  $bold.Dispose()
  $e.HasMorePages = $false
})

function New-ThermalReceiptBitmap {
  $pageW = 576
  $bmp = New-Object System.Drawing.Bitmap $pageW, 2200, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $left = 16
  $width = 544
  $y = 8
  $brush = [System.Drawing.Brushes]::Black
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::Black), 2
  $center = New-Object System.Drawing.StringFormat
  $center.Alignment = [System.Drawing.StringAlignment]::Center
  $right = New-Object System.Drawing.StringFormat
  $right.Alignment = [System.Drawing.StringAlignment]::Far
  $px = [System.Drawing.GraphicsUnit]::Pixel
  $titleFont = New-Object System.Drawing.Font("Arial", 40, [System.Drawing.FontStyle]::Bold, $px)
  $font = New-Object System.Drawing.Font("Arial", 24, [System.Drawing.FontStyle]::Bold, $px)
  $small = New-Object System.Drawing.Font("Arial", 20, [System.Drawing.FontStyle]::Bold, $px)
  $bold = New-Object System.Drawing.Font("Arial", 26, [System.Drawing.FontStyle]::Bold, $px)

  $g.DrawString([string]$script:receipt.storeName, $titleFont, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 48)), $center)
  $y += 48

  if ($script:receipt.location) {
    $arabic = New-Object System.Drawing.StringFormat
    $arabic.Alignment = [System.Drawing.StringAlignment]::Center
    $arabic.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft
    $locFont = New-Object System.Drawing.Font("Tahoma", 26, [System.Drawing.FontStyle]::Bold, $px)
    $g.DrawString([string]$script:receipt.location, $locFont, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 36)), $arabic)
    $locFont.Dispose()
    $y += 36
  }
  if ($script:receipt.address) {
    $g.DrawString([string]$script:receipt.address, $small, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 28)), $center)
    $y += 28
  }
  if ($script:receipt.phone) {
    $g.DrawString([string]$script:receipt.phone, $small, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 28)), $center)
    $y += 28
  }

  $y += 8
  foreach ($line in @(
    ("Receipt: " + $script:receipt.receiptNumber),
    ("Date: " + $script:receipt.date),
    ("Cashier: " + $script:receipt.cashier),
    ("Payment: " + $script:receipt.payment),
    ("Pricing: " + $script:receipt.pricing)
  )) {
    $g.DrawString($line, $font, $brush, $left, $y)
    $y += 30
  }

  $y += 8
  $g.DrawLine($pen, $left, $y, ($left + $width), $y)
  $y += 8
  $colQty = 70
  $colAmt = 130
  $nameW = $width - $colQty - $colAmt
  $g.DrawString("Item", $bold, $brush, $left, $y)
  $g.DrawString("Qty", $bold, $brush, (New-Object System.Drawing.RectangleF(($left + $nameW), $y, $colQty, 32)), $center)
  $g.DrawString("Total", $bold, $brush, (New-Object System.Drawing.RectangleF(($left + $nameW + $colQty), $y, $colAmt, 32)), $right)
  $y += 34
  $g.DrawLine($pen, $left, $y, ($left + $width), $y)
  $y += 8

  foreach ($item in $script:items) {
    $g.DrawString([string]$item.name, $font, $brush, (New-Object System.Drawing.RectangleF($left, $y, $nameW, 30)))
    $g.DrawString([string]$item.qty, $font, $brush, (New-Object System.Drawing.RectangleF(($left + $nameW), $y, $colQty, 30)), $center)
    $g.DrawString([string]$item.total, $font, $brush, (New-Object System.Drawing.RectangleF(($left + $nameW + $colQty), $y, $colAmt, 30)), $right)
    $y += 30
    if ($item.each) {
      $g.DrawString([string]$item.each, $small, $brush, $left, $y)
      $y += 26
    }
  }

  $y += 6
  $g.DrawLine($pen, $left, $y, ($left + $width), $y)
  $y += 10
  $rows = New-Object System.Collections.Generic.List[object]
  $rows.Add(@{ Label = "Subtotal"; Value = $script:receipt.subtotal; Bold = $false }) | Out-Null
  if ($script:receipt.discount) { $rows.Add(@{ Label = "Discount"; Value = $script:receipt.discount; Bold = $false }) | Out-Null }
  if ($script:receipt.tax) { $rows.Add(@{ Label = "Tax"; Value = $script:receipt.tax; Bold = $false }) | Out-Null }
  $rows.Add(@{ Label = "Total $"; Value = $script:receipt.totalUsd; Bold = $true }) | Out-Null
  $rows.Add(@{ Label = "Total L.L"; Value = $script:receipt.totalLbp; Bold = $true }) | Out-Null
  $rows.Add(@{ Label = "Rate"; Value = $script:receipt.rate; Bold = $false }) | Out-Null
  foreach ($row in $rows) {
    $f = if ($row.Bold) { $bold } else { $font }
    $h = if ($row.Bold) { 34 } else { 30 }
    $g.DrawString([string]$row.Label, $f, $brush, $left, $y)
    $g.DrawString([string]$row.Value, $f, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, $h)), $right)
    $y += $h
  }

  if ($script:receipt.amountReceived) {
    $y += 8
    $g.DrawLine($pen, $left, $y, ($left + $width), $y)
    $y += 10
    foreach ($row in @(
      @{ Label = "Paid in"; Value = $script:receipt.paidIn; Bold = $false },
      @{ Label = "Amount received"; Value = $script:receipt.amountReceived; Bold = $false },
      @{ Label = "Change $"; Value = $script:receipt.changeUsd; Bold = $true },
      @{ Label = "Change L.L"; Value = $script:receipt.changeLbp; Bold = $true },
      @{ Label = "Change given in"; Value = $script:receipt.changeIn; Bold = $false }
    )) {
      $f = if ($row.Bold) { $bold } else { $font }
      $h = if ($row.Bold) { 34 } else { 30 }
      $g.DrawString([string]$row.Label, $f, $brush, $left, $y)
      $g.DrawString([string]$row.Value, $f, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, $h)), $right)
      $y += $h
    }
  }

  if ($script:receipt.footer) {
    $y += 16
    $g.DrawString([string]$script:receipt.footer, $small, $brush, (New-Object System.Drawing.RectangleF($left, $y, $width, 56)), $center)
    $y += 56
  }

  $titleFont.Dispose(); $font.Dispose(); $small.Dispose(); $bold.Dispose(); $pen.Dispose(); $g.Dispose()
  $cropH = [Math]::Min($bmp.Height, [int]$y + 16)
  $trimmed = $bmp.Clone((New-Object System.Drawing.Rectangle 0, 0, $pageW, $cropH), $bmp.PixelFormat)
  $bmp.Dispose()
  return $trimmed
}

$isThermal = $printerName -eq "POS-80" -or ($printerName -match "Thermal|Receipt" -and $printerName -notmatch "Label|XP-365|365B")
if ($isThermal) {
  Send-EscPosReceipt $printerName
} else {
  $doc.Print()
}
$doc.Dispose()

$result = @{
  printer = $printerName
  mode = $(if ($printToFile) { "pdf" } else { "printer" })
  pdf = $(if ($printToFile) { $PdfPath } else { $null })
}
$result | ConvertTo-Json -Compress
exit 0
