param(
  [Parameter(Mandatory = $true)][string]$JsonPath
)

$ErrorActionPreference = "Stop"

$job = Get-Content -Raw -Encoding UTF8 $JsonPath | ConvertFrom-Json
$labels = @($job.labels)
if ($labels.Count -lt 1) { throw "NO_LABELS" }

function Get-LabelPrinterName {
  $printers = @(Get-CimInstance Win32_Printer)
  $named = $printers | Where-Object { $_.Name -match "Label Printer|XP-365|365B" -and $_.Name -ne "POS-80" } | Select-Object -First 1
  if ($named) { return $named.Name }
  $byPort = $printers | Where-Object { $_.PortName -eq "USB002" -and $_.Name -ne "POS-80" } | Select-Object -First 1
  if ($byPort) { return $byPort.Name }
  throw "NO_LABEL_PRINTER"
}

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
    di.pDocName = "VANO label";
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

function Convert-TsplText([string]$Value, [int]$Max) {
  $clean = [regex]::Replace($Value, "[^\x20-\x7E]", "")
  $clean = $clean.Replace('"', "'").Trim()
  if ($clean.Length -gt $Max) { $clean = $clean.Substring(0, $Max) }
  return $clean
}

function Get-CenterX([int]$widthDots) {
  $x = [int]((320 - $widthDots) / 2)
  if ($x -lt 0) { return 0 }
  return $x
}

function Add-Ascii([System.IO.MemoryStream]$Stream, [string]$Text) {
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($Text)
  $Stream.Write($bytes, 0, $bytes.Length)
}

function Get-BarcodeLayout([string]$Code) {
  $numeric = $Code -match '^\d+$' -and $Code.Length -ge 2
  if ($numeric) {
    $pairs = [Math]::Floor($Code.Length / 2)
    $extra = 0
    if ($Code.Length % 2 -eq 1) { $extra = 2 }
    $body = 1 + $pairs + $extra + 1
    if ($Code.Length % 2 -eq 0) {
      $data = "!105$Code"
    } else {
      $data = "!105" + $Code.Substring(0, $Code.Length - 1) + "!100" + $Code.Substring($Code.Length - 1)
    }
    $type = "128M"
  } else {
    $body = 1 + $Code.Length + 1
    $data = $Code
    $type = "128"
  }
  $modules = ($body * 11) + 13
  $narrow = 2
  if (($modules * 2) -gt 270) { $narrow = 1 }
  $width = $modules * $narrow
  return @{
    Type = $type
    Data = $data
    Narrow = $narrow
    X = (Get-CenterX $width)
  }
}

$printerName = Get-LabelPrinterName
$ms = New-Object System.IO.MemoryStream
Add-Ascii $ms "SIZE 40 mm, 30 mm`r`n"
Add-Ascii $ms "GAP 2 mm, 0 mm`r`n"
Add-Ascii $ms "DIRECTION 1`r`n"
Add-Ascii $ms "REFERENCE 0,0`r`n"
Add-Ascii $ms "DENSITY 12`r`n"
Add-Ascii $ms "SPEED 2`r`n"
Add-Ascii $ms "CLS`r`n"

foreach ($label in $labels) {
  $name = Convert-TsplText ([string]$label.name) 22
  $price = Convert-TsplText ([string]$label.price) 12
  $code = Convert-TsplText ([string]$label.barcode) 20
  if (-not $code) { continue }
  $layout = Get-BarcodeLayout $code
  $nameX = Get-CenterX ($name.Length * 12)
  $priceX = Get-CenterX ($price.Length * 16)
  Add-Ascii $ms "CLS`r`n"
  Add-Ascii $ms "TEXT $nameX,6,""2"",0,1,1,""$name""`r`n"
  Add-Ascii $ms "TEXT $priceX,28,""3"",0,1,1,""$price""`r`n"
  Add-Ascii $ms ("BARCODE {0},58,""{1}"",100,1,0,{2},2,""{3}""`r`n" -f $layout.X, $layout.Type, $layout.Narrow, $layout.Data)
  Add-Ascii $ms "PRINT 1`r`n"
}

[RawPrinter]::Send($printerName, $ms.ToArray())
$ms.Dispose()

@{
  printer = $printerName
  mode = "label"
  count = $labels.Count
} | ConvertTo-Json -Compress
exit 0
