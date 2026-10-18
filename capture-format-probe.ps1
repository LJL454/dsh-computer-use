# Capture-format benchmark: how long does each encode path take for a real desktop?
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
$w = $screen.Width; $h = $screen.Height
Write-Output ("virtual screen: {0}x{1} at ({2},{3})" -f $w, $h, $screen.X, $screen.Y)

function New-Shot([int]$w, [int]$h, [int]$x, [int]$y) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)), [System.Drawing.CopyPixelOperation]::SourceCopy)
  $g.Dispose()
  return $bmp
}

function Scale-Bmp($src, [double]$factor) {
  $nw = [int]($src.Width * $factor); $nh = [int]($src.Height * $factor)
  $dst = New-Object System.Drawing.Bitmap($nw, $nh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, 0, 0, $nw, $nh)
  $g.Dispose()
  return $dst
}

function Get-JpegCodec {
  [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
}

$jpegCodec = Get-JpegCodec
$jpegParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$jpegParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]80)

$tmp = Join-Path $env:TEMP 'cu-format-bench'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Report($label, $bmp, $path, $encoder) {
  $t = [System.Diagnostics.Stopwatch]::StartNew()
  if ($null -eq $encoder) { $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) }
  elseif ($encoder -eq 'jpeg') { $bmp.Save($path, $jpegCodec, $jpegParams) }
  $ms = $t.Elapsed.TotalMilliseconds
  $size = (Get-Item $path).Length
  Write-Output ("{0,-34} {1,7:N0} ms   {2,8:N0} KB" -f $label, $ms, ($size / 1KB))
}

foreach ($round in 1..2) {
  Write-Output "--- round $round ---"
  $t = [System.Diagnostics.Stopwatch]::StartNew()
  $full = New-Shot $w $h $screen.X $screen.Y
  Write-Output ("{0,-34} {1,7:N0} ms" -f 'BitBlt capture full', $t.Elapsed.TotalMilliseconds)

  Report 'PNG full 2560x1440' $full (Join-Path $tmp 'full.png') $null

  $t = [System.Diagnostics.Stopwatch]::StartNew()
  $half = Scale-Bmp $full 0.5
  Write-Output ("{0,-34} {1,7:N0} ms" -f 'downscale to 1280x720', $t.Elapsed.TotalMilliseconds)
  Report 'PNG half 1280x720' $half (Join-Path $tmp 'half.png') $null
  Report 'JPEG half 1280x720 q80' $half (Join-Path $tmp 'half.jpg') 'jpeg'
  Report 'JPEG full 2560x1440 q80' $full (Join-Path $tmp 'full.jpg') 'jpeg'

  $t = [System.Diagnostics.Stopwatch]::StartNew()
  $rect = New-Object System.Drawing.Rectangle(0, 0, $full.Width, $full.Height)
  $data = $full.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $full.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $full.UnlockBits($data)
  [System.IO.File]::WriteAllBytes((Join-Path $tmp 'full.bgra'), $bytes)
  Write-Output ("{0,-34} {1,7:N0} ms   {2,8:N0} KB" -f 'raw BGRA copy + write', $t.Elapsed.TotalMilliseconds, ((Get-Item (Join-Path $tmp 'full.bgra')).Length / 1KB))

  $full.Dispose(); $half.Dispose()
}
Write-Output ("files in $tmp")
