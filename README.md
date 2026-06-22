TFG - Prototipo Blockchain para Trazabilidad Farmaceutica

Prototipo basado en blockchain para la trazabilidad y verificacion de la cadena de suministro farmaceutica, desarrollado como TFG en Ingenieria Industrial (ICAI, Universidad Pontificia Comillas).

Descripcion
Este proyecto implementa una arquitectura hibrida on-chain/off-chain para el seguimiento de lotes farmaceuticos a lo largo de la cadena de suministro (Fabricante, Logistica, Distribuidor, Farmacia), con verificacion de roles, control de temperatura y deteccion automatica de incidencias.
Estructura del proyecto

contracts/Trazabilidad.sol - Contrato inteligente principal (Solidity)
scripts/deploy.js - Despliegue del contrato en red local
scripts/simular_100lotes.js - Simulacion de 100 lotes con escenarios probabilisticos
scripts/consultar_snapshot.js - Consulta del estado actual de los lotes
scripts/consultar_historial.js - Consulta del historial completo de un lote
scripts/falsificacion.js - Pruebas de seguridad ante intentos de manipulacion
hardhat.config.js - Configuracion de Hardhat

Requisitos

Node.js
Hardhat

Instalacion y ejecucion
Nodo local de Hardhat:
npm install
npx hardhat node
En otra terminal, con el nodo anterior corriendo:
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/simular_100lotes.js --network localhost
npx hardhat run scripts/consultar_snapshot.js --network localhost
npx hardhat run scripts/consultar_historial.js --network localhost
npx hardhat run scripts/falsificacion.js --network localhost

Autor
Guillermo Garcia Gonzalez - ICAI, Universidad Pontificia Comillas
