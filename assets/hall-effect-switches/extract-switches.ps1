param(
    [string]$HarPath = "../../xsyd.top.har"
)

$ErrorActionPreference = "Stop"
$outputDirectory = $PSScriptRoot
$resolvedHarPath = (Resolve-Path (Join-Path $outputDirectory $HarPath)).Path
$har = Get-Content -Raw -LiteralPath $resolvedHarPath | ConvertFrom-Json
$entry = $har.log.entries |
    Where-Object { $_.request.url -match "/api/v1/getAxisListV3" -and $_.response.content.text } |
    Select-Object -First 1

if (-not $entry) {
    throw "No populated getAxisListV3 response was found in $resolvedHarPath"
}

$response = $entry.response.content.text | ConvertFrom-Json
$switches = @(
    foreach ($group in $response.data) {
        foreach ($switch in $group.list) {
            [ordered]@{
                axis_id = $switch.axis_id
                group_name = $group.type_name_en
                group_name_zh = $group.type_name
                brand = $switch.brand
                switch_name = $switch.axis_name
                axis_range_max = $switch.aixsDetail[0].axis_range_max
                magnetic_flux = $switch.magnetic_flux
                axis_color = $switch.axis_color
                image_url = $switch.image_url
                detail_axis_id = $switch.aixsDetail[0].axis_id
                axis_coefficient = $switch.aixsDetail[0].axis_coefficient
            }
        }
    }
)

if ($switches.Count -ne 82) {
    throw "Expected 82 switches but extracted $($switches.Count)"
}

# Keep the editable catalog complete without overwriting names, aliases, or
# images that an author has already supplied. The underscore-prefixed fields
# are reference-only context from the latest capture and are ignored by the UI.
$overridesPath = Join-Path $outputDirectory "catalog-overrides.json"
$existingOverrides = @{}
if (Test-Path -LiteralPath $overridesPath) {
    $parsedOverrides = Get-Content -Raw -LiteralPath $overridesPath | ConvertFrom-Json
    if ($parsedOverrides) {
        foreach ($property in $parsedOverrides.PSObject.Properties) {
            $existingOverrides[$property.Name] = $property.Value
        }
    }
}
$catalogOverrides = [ordered]@{}
foreach ($switch in $switches) {
    $id = [string]$switch.detail_axis_id
    $existing = $existingOverrides[$id]
    $override = [ordered]@{
        name = if ($null -ne $existing -and $null -ne $existing.name) { [string]$existing.name } else { "" }
        aliases = @(if ($null -ne $existing -and $null -ne $existing.aliases) { $existing.aliases })
        image = if ($null -ne $existing -and $null -ne $existing.image) { [string]$existing.image } else { "" }
        _captured_name = [string]$switch.switch_name
        _captured_brand = [string]$switch.brand
    }
    foreach ($optionalField in @("brand", "color")) {
        if ($null -ne $existing -and $null -ne $existing.$optionalField) {
            $override[$optionalField] = [string]$existing.$optionalField
        }
    }
    $catalogOverrides[$id] = $override
}

$metadata = [ordered]@{
    extracted_at = (Get-Date).ToUniversalTime().ToString("o")
    har_file = (Split-Path -Leaf $resolvedHarPath)
    captured_request_url = $entry.request.url
    captured_started_at = $entry.startedDateTime
    response_status = $entry.response.status
    api_code = $response.code
    api_message = $response.msg
    group_count = $response.data.Count
    switch_count = $switches.Count
    groups = @($response.data | ForEach-Object {
        [ordered]@{
            name = $_.type_name_en
            name_zh = $_.type_name
            type_id = $_.type_id
            count = $_.list.Count
        }
    })
}

$response | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $outputDirectory "raw-api-response.json")
$switches | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $outputDirectory "supported-switches.json")
$switches | Export-Csv -NoTypeInformation -Encoding utf8 -LiteralPath (Join-Path $outputDirectory "supported-switches.csv")
$metadata | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $outputDirectory "source-metadata.json")
$catalogOverrides | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 -LiteralPath $overridesPath

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# Supported Hall-effect switches")
$lines.Add("")
$lines.Add("The captured `getAxisListV3` response contains **82 switch profiles** for board `0030000a` (USB VID `1ca6`, PID `300a`). Names below are preserved exactly as returned by the driver API.")
$lines.Add("")
$lines.Add("| # | API ID | Group | Brand | Switch name | Range max | Magnetic flux | Coefficient |")
$lines.Add("|---:|---:|---|---|---|---:|---:|---:|")
$index = 0
foreach ($switch in $switches) {
    $index++
    $lines.Add("| $index | $($switch.axis_id) | $($switch.group_name) | $($switch.brand) | $($switch.switch_name) | $($switch.axis_range_max) | $($switch.magnetic_flux) | $($switch.axis_coefficient) |")
}
$lines.Add("")
$lines.Add("Source request: ``$($entry.request.url)``")
$lines | Set-Content -Encoding utf8 -LiteralPath (Join-Path $outputDirectory "supported-switches.md")

Write-Output "Extracted $($switches.Count) switches from $resolvedHarPath"
