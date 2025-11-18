@echo off
REM Ubica el script dentro de la carpeta raíz del proyecto.
cd /d "%~dp0"

REM Puerto por defecto para servir los archivos.
set "PORT=3000"

REM Usa npx serve para desplegar el contenido estático.
echo Iniciando frontend en http://localhost:%PORT%
npx serve . -l %PORT%
