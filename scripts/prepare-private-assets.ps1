param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePublicDir
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $SourcePublicDir).Path
$required = @('cards_db.json', 'rules_db.json', 'cards')
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $source $name))) {
    throw "Missing required web asset: $name"
  }
}

$sourceCards = Join-Path $source 'cards'
$sourceImages = @(Get-ChildItem -LiteralPath $sourceCards -File)
if ($sourceImages.Count -ne 36) { throw "Expected 36 source card images, found $($sourceImages.Count)." }

# Vite serves files from public/ during local development. The Docker production
# build deliberately excludes public assets and serves the private-assets copy
# through the authenticated Caddy container instead.
$targets = @(
  (Join-Path $PSScriptRoot '..\private-assets'),
  (Join-Path $PSScriptRoot '..\public')
)
foreach ($target in $targets) {
  $target = [System.IO.Path]::GetFullPath($target)
  $targetCards = Join-Path $target 'cards'
  $null = New-Item -ItemType Directory -Force -Path $targetCards
  Copy-Item -LiteralPath (Join-Path $source 'cards_db.json') -Destination $target -Force
  Copy-Item -LiteralPath (Join-Path $source 'rules_db.json') -Destination $target -Force

  # Existing filenames are overwritten; unrelated files are left untouched.
  $sourceImages | Copy-Item -Destination $targetCards -Force

  $copiedCount = (Get-ChildItem -LiteralPath $targetCards -File).Count
  if ($copiedCount -ne 36) { throw "Expected 36 card images in $targetCards, found $copiedCount." }
}

Write-Output 'Prepared 36 private card images and card data for local Vite use and private deployment.'
