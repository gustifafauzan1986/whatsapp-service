Set WshShell = CreateObject("WScript.Shell")
' Angka 0 di akhir baris artinya HIDE WINDOW (Sembunyikan Jendela)
WshShell.Run chr(34) & "D:\nginx\html\whatsapp-service\wa.bat" & chr(34), 0
Set WshShell = Nothing