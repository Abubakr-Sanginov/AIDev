@echo off
rem AI Dev Team launcher - runs the committed build without a global npm install.
rem Keep this file in the repository root; it resolves dist\cli.js relative to itself.
node "%~dp0dist\cli.js" %*
