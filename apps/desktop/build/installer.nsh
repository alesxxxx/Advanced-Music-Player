!include "LogicLib.nsh"
!include "MUI2.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
  Var DesktopShortcutCheckbox
  Var CreateDesktopShortcutSelection

  !macro customInit
    StrCpy $CreateDesktopShortcutSelection "true"
  !macroend

  !macro customPageAfterChangeDir
    Page Custom DesktopShortcutPageCreate DesktopShortcutPageLeave
  !macroend

  Function DesktopShortcutPageCreate
    !insertmacro MUI_HEADER_TEXT "Additional options" "Choose the shortcuts to create for AMP."

    nsDialogs::Create 1018
    Pop $0

    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "Pick any extra shortcuts to create during installation."
    Pop $0

    ${NSD_CreateCheckbox} 0 32u 100% 12u "&Create a desktop shortcut"
    Pop $DesktopShortcutCheckbox

    ${If} $CreateDesktopShortcutSelection == "true"
      ${NSD_Check} $DesktopShortcutCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function DesktopShortcutPageLeave
    ${NSD_GetState} $DesktopShortcutCheckbox $0

    ${If} $0 == ${BST_CHECKED}
      StrCpy $CreateDesktopShortcutSelection "true"
    ${Else}
      StrCpy $CreateDesktopShortcutSelection "false"
    ${EndIf}
  FunctionEnd
!endif

!macro customInstall
  ${If} $CreateDesktopShortcutSelection == "true"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${Else}
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    ${If} $oldDesktopLink != $newDesktopLink
      WinShell::UninstShortcut "$oldDesktopLink"
      Delete "$oldDesktopLink"
    ${EndIf}
  ${EndIf}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  WinShell::UninstShortcut "$newDesktopLink"
  Delete "$newDesktopLink"

  ${If} $oldDesktopLink != $newDesktopLink
    WinShell::UninstShortcut "$oldDesktopLink"
    Delete "$oldDesktopLink"
  ${EndIf}
!macroend
