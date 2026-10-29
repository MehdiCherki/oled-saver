# Zips a plugin folder with "/" entry names (Compress-Archive in PowerShell 5 writes "\",
# which some extractors keep as part of the file name). The folder itself is the zip root.
param([Parameter(Mandatory)] [string]$Source, [Parameter(Mandatory)] [string]$Destination)

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }

$Source = [System.IO.Path]::GetFullPath($Source).TrimEnd([char]92)
$base = [System.IO.Path]::GetDirectoryName($Source)
$archive = [System.IO.Compression.ZipFile]::Open($Destination, 'Create')
try {
  Get-ChildItem -LiteralPath $Source -Recurse -File | ForEach-Object {
    $name = $_.FullName.Substring($base.Length + 1).Replace([char]92, [char]47)
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $name, 'Optimal')
  }
} finally {
  $archive.Dispose()
}
