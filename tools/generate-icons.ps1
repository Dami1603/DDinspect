# DDinspect - icon generator
# Renders the SVG masters in extension/icons/ to the PNG sizes browsers need:
#   logo-small.svg -> icon16.png, icon32.png   (flat, thick strokes: readable in the toolbar)
#   logo.svg       -> icon48.png, icon128.png  (full design with the box model layers)
# Also renders store/promo.html to store/promo-440x280.png.
#
# Each SVG is drawn at 512 px by headless Microsoft Edge (or Chrome), then scaled down with
# high-quality bicubic resampling, which antialiases the small sizes far better than drawing them
# directly.
#
# Usage:  powershell -ExecutionPolicy Bypass -File tools\generate-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$iconDir = Join-Path $root 'extension\icons'
$storeDir = Join-Path $root 'store'
$work = Join-Path ([System.IO.Path]::GetTempPath()) 'ddinspect-icons'
New-Item -ItemType Directory -Force $work | Out-Null

$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Microsoft Edge or Google Chrome is needed to render the SVGs.' }

# Screenshot of a local file with a transparent background.
function Render-Page($file, $width, $height, $out) {
  $url = 'file:///' + ($file -replace '\\', '/')
  $profile = Join-Path $work 'profile'
  & $browser --headless=new --disable-gpu --hide-scrollbars --no-first-run "--user-data-dir=$profile" `
    --default-background-color=00000000 "--window-size=$width,$height" "--screenshot=$out" $url 2>$null | Out-Null
  for ($i = 0; $i -lt 50 -and -not (Test-Path $out); $i++) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path $out)) { throw "Could not render $file" }
}

# Wraps an SVG in a page that draws it at exactly $size px.
function Render-Svg($svg, $size, $out) {
  $page = Join-Path $work ([System.IO.Path]::GetFileNameWithoutExtension($svg) + '.html')
  $src = 'file:///' + ($svg -replace '\\', '/')
  "<!doctype html><html><body style=`"margin:0;background:transparent`"><img src=`"$src`" width=`"$size`" height=`"$size`" style=`"display:block`"></body></html>" |
    Set-Content -Encoding utf8 $page
  if (Test-Path $out) { Remove-Item $out }
  Render-Page $page $size $size $out
}

function Save-Scaled($source, $size, $out) {
  $src = [System.Drawing.Image]::FromFile($source)
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.DrawImage($src, 0, 0, $size, $size)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $src.Dispose()
  Write-Host "Created $out"
}

$small = Join-Path $work 'small-512.png'
$large = Join-Path $work 'large-512.png'
Render-Svg (Join-Path $iconDir 'logo-small.svg') 512 $small
Render-Svg (Join-Path $iconDir 'logo.svg') 512 $large

foreach ($size in 16, 32) { Save-Scaled $small $size (Join-Path $iconDir "icon$size.png") }
foreach ($size in 48, 128) { Save-Scaled $large $size (Join-Path $iconDir "icon$size.png") }

$promo = Join-Path $storeDir 'promo.html'
if (Test-Path $promo) {
  $out = Join-Path $storeDir 'promo-440x280.png'
  if (Test-Path $out) { Remove-Item $out }
  Render-Page $promo 440 280 $out
  Write-Host "Created $out"
}
