param(
  [Parameter(Mandatory = $true)][string]$Amount
)

$ErrorActionPreference = "Stop"

function Write-DisplayLog([string]$Message) {
  try {
    $dir = Join-Path $env:APPDATA "VANO POS"
    if (-not (Test-Path $dir)) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Set-Content -Path (Join-Path $dir "display.log") -Value $Message -Encoding ASCII
  } catch {
  }
}

function Get-DisplayPorts {
  if ($env:VANO_PRICE_PORT) { return @($env:VANO_PRICE_PORT) }
  return @("COM2", "COM1")
}

$number = 0.0
$parsed = [double]::TryParse(
  $Amount,
  [System.Globalization.NumberStyles]::Float,
  [System.Globalization.CultureInfo]::InvariantCulture,
  [ref]$number
)
if (-not $parsed) { $number = 0 }
$text = $number.ToString("0.00", [System.Globalization.CultureInfo]::InvariantCulture)
$digits = -join ($text.ToCharArray() | Where-Object { $_ -match "[0-9.]" })
if (-not $digits) { $digits = "0.00" }
if ($digits.Length -gt 8) { $digits = $digits.Substring(0, 8) }

# LED8 inside this PC. Do not send ESC @ — that command puts the screen back on 000.
# ESC s 2 turns on Total. ESC Q A then shows the digits. n must be the character "2".
$frame = New-Object System.Collections.Generic.List[byte]
foreach ($b in [byte[]](0x1B, 0x73, 0x32, 0x1B, 0x51, 0x41)) { $frame.Add($b) }
foreach ($b in [System.Text.Encoding]::ASCII.GetBytes($digits)) { $frame.Add($b) }
$frame.Add(0x0D)
$payload = $frame.ToArray()

try {
  Add-Type -AssemblyName System.IO.Ports -ErrorAction SilentlyContinue
} catch {
}

$mutex = New-Object System.Threading.Mutex($false, "Global\VANO-Price-Display")
$locked = $false
try {
  $locked = $mutex.WaitOne(2000)
} catch {
  $locked = $true
}
if (-not $locked) {
  Write-DisplayLog "busy"
  exit 0
}

$sent = $false
$errors = New-Object System.Collections.Generic.List[string]
try {
  foreach ($portName in @(Get-DisplayPorts)) {
    foreach ($baud in @(9600, 2400)) {
      $port = $null
      try {
        $port = New-Object System.IO.Ports.SerialPort $portName, $baud, "None", 8, "One"
        $port.Handshake = "None"
        $port.WriteTimeout = 500
        $port.DtrEnable = $true
        $port.RtsEnable = $true
        $port.Open()
        Start-Sleep -Milliseconds 80
        $port.Write($payload, 0, $payload.Length)
        $port.BaseStream.Flush()
        Start-Sleep -Milliseconds 80
        $sent = $true
        Write-DisplayLog ("sent {0} on {1} at {2}" -f $digits, $portName, $baud)
      } catch {
        $errors.Add(("{0} {1}: {2}" -f $portName, $baud, $_.Exception.Message))
      } finally {
        if ($port) {
          if ($port.IsOpen) { $port.Close() }
          $port.Dispose()
        }
      }
    }
  }
} finally {
  try { $mutex.ReleaseMutex() } catch { }
  $mutex.Dispose()
}

if (-not $sent) {
  Write-DisplayLog ("failed " + ($errors -join " | "))
}

exit 0
