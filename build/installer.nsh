!macro customInstall
  ; Wipe any previously saved Gemini key so every install re-prompts.
  Delete "$APPDATA\Ask Margaret\.env"
  Delete "$APPDATA\ask-margaret\.env"
!macroend
