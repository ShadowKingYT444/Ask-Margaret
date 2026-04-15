param(
  [string]$Text = "Where should I press to send a message right now?",
  [string]$Out = "test_screens/live.wav"
)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$full = Join-Path (Get-Location) $Out
$s.SetOutputToWaveFile($full)
$s.Speak($Text)
$s.Dispose()
Write-Host "wrote $full"
