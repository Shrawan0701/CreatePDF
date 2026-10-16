param([Parameter(Mandatory=$true)][string]$InputPath, [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$office = $null
$document = $null
try {
    $office = New-Object -ComObject Word.Application
    $office.Visible = $false
    $office.DisplayAlerts = 0
    $office.AutomationSecurity = 3
    $office.Options.UpdateLinksAtOpen = $false
    $confirmConversions = $false
    $readOnly = $true
    $addToRecentFiles = $false
    $document = $office.Documents.Open([ref]$InputPath, [ref]$confirmConversions, [ref]$readOnly, [ref]$addToRecentFiles)
    $document.ExportAsFixedFormat($OutputPath, 17, $false, 0, 0)
} finally {
    $saveChanges = 0
    if ($null -ne $document) {
        $document.Close([ref]$saveChanges)
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
    }
    if ($null -ne $office) {
        $office.Quit([ref]$saveChanges)
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($office)
    }
}
