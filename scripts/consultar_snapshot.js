const hre = require("hardhat");

// Nombres de los roles tal como estan definidos en el contrato 
const NOMBRES_ROL = ["FABRICANTE", "LOGISTICA", "DISTRIBUIDOR", "FARMACIA", "REGULADOR", "ADMINISTRADOR"];

async function obtenerNombreRol(contrato, direccion) {
  const rolDeLaDireccion = await contrato.roles(direccion);
  for (const nombre of NOMBRES_ROL) {
    const hashRol = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(nombre));
    if (rolDeLaDireccion === hashRol) {
      return nombre;
    }
  }
  return "SIN ROL ASIGNADO";
}

async function main() {
  const direccionContrato = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Cambiar
  const Trazabilidad = await hre.ethers.getContractFactory("Trazabilidad");
  const contrato = Trazabilidad.attach(direccionContrato);

  const total = await contrato.totalSnapshots();
  console.log("Total de snapshots de hashes registrados:", total.toString());

  const snapshot = await contrato.obtenerUltimoSnapshot();
  const nombreRol = await obtenerNombreRol(contrato, snapshot.registradoPor);

  console.log("\nULTIMO SNAPSHOT ANCLADO ON-CHAIN");
  console.log("Hash lotes.csv        :", snapshot.hashLotes);
  console.log("Hash temperaturas.csv :", snapshot.hashTemperaturas);
  console.log("Hash operaciones.csv  :", snapshot.hashOperaciones);
  console.log("Timestamp (Unix)      :", snapshot.timestamp.toString());
  console.log("Registrado por        :", snapshot.registradoPor, `(${nombreRol})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});