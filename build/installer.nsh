; Inventru app installer additions (included by electron-builder's NSIS script).

; electron-builder keeps a copy of the installer (about 120 MB) in %LOCALAPPDATA%\inventrustock-app-updater for its
; auto-updater. Inventru has no auto-updater (updates are installed by running the new installer), so don't keep it.
!macro customInstall
  Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  RMDir "$LOCALAPPDATA\inventrustock-app-updater"
!macroend

; Uninstalling (not updating) also removes the "Start when I sign in to Windows" entry the app keeps for this user.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Inventru"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Inventru"
    RMDir /r "$LOCALAPPDATA\inventrustock-app-updater"
  ${endIf}
!macroend
