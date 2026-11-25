@echo off
rem Builds Pitchlens.exe (the desktop window) with the C# compiler that ships with Windows (.NET Framework 4).
rem Needs runtime\Microsoft.Web.WebView2.Core.dll and runtime\Microsoft.Web.WebView2.WinForms.dll
rem (from the Microsoft.Web.WebView2 NuGet package, lib\net462) and runtime\WebView2Loader.dll (runtimes\win-x64\native).
cd /d "%~dp0.."
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ ^
  /win32icon:web\pitchlens.ico /out:Pitchlens.exe ^
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Net.dll ^
  /r:runtime\Microsoft.Web.WebView2.Core.dll /r:runtime\Microsoft.Web.WebView2.WinForms.dll ^
  launcher\Pitchlens.cs
