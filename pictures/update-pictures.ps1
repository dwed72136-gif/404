# 그림 폴더(pictures) 안의 이미지 파일 목록을 manifest.json으로 저장합니다.
Set-Location -Path $PSScriptRoot

$files = Get-ChildItem -File |
  Where-Object { $_.Name -ne 'manifest.json' -and $_.Extension -match '\.(png|jpg|jpeg|gif|webp|bmp)$' } |
  Select-Object -ExpandProperty Name |
  Sort-Object

if ($files.Count -eq 0) {
    $json = "[]"
} elseif ($files.Count -eq 1) {
    $json = '[' + '"' + ($files[0] -replace '"','\"') + '"' + ']'
} else {
    $escaped = $files | ForEach-Object { '"' + ($_ -replace '"','\"') + '"' }
    $json = "[`n  " + ($escaped -join ",`n  ") + "`n]"
}

Set-Content -Path (Join-Path $PSScriptRoot 'manifest.json') -Value $json -Encoding UTF8
Write-Host ("그림 목록을 업데이트했습니다! (" + $files.Count + "장)")
