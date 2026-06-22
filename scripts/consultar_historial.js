const hre = require("hardhat");
const { keccak256, toUtf8Bytes } = require("ethers");
 
// Cambiar el nombre del lote 
const NOMBRE_LOTE = "LOTE-001";
 
const ESTADOS = ["Creado", "EnTransito", "Recibido", "Dispensado", "Comprometido"];

const ROLES = {
  [keccak256(toUtf8Bytes("FABRICANTE"))]:   "Fabricante",
  [keccak256(toUtf8Bytes("LOGISTICA"))]:    "Logistica",
  [keccak256(toUtf8Bytes("DISTRIBUIDOR"))]: "Distribuidor",
  [keccak256(toUtf8Bytes("FARMACIA"))]:     "Farmacia",
  [keccak256(toUtf8Bytes("REGULADOR"))]:    "Regulador",
  [keccak256(toUtf8Bytes("ADMINISTRADOR"))]:"Administrador",
};

// Dado una dirección, consulta su rol on-chain y devuelve "Rol (0xabc...123)"
async function formatearActor(contrato, direccion) {
  const hashRol = await contrato.roles(direccion);
  const nombreRol = ROLES[hashRol] || "Rol desconocido";
  const corta = `${direccion.slice(0, 6)}...${direccion.slice(-4)}`;
  return `${nombreRol} (${corta})`;
}
 
async function main() {
  const direccionContrato = "0x5FbDB2315678afecb367f032d93F642f64180aa3";  // CAMBIAR direccion del contrato
  const Trazabilidad = await hre.ethers.getContractFactory("Trazabilidad");
  const contrato = Trazabilidad.attach(direccionContrato);
 
  // El contrato necesita el ID en formato bytes32
  const IDLote = keccak256(toUtf8Bytes(NOMBRE_LOTE));
 
  const [lote, temperaturas, custodios] = await contrato.obtenerHistorial(IDLote);
 
  console.log(`\nHISTORIAL DE ${NOMBRE_LOTE}`);
  console.log("Medicamento     :", lote.nombreMedicamento);
  console.log("Estado final    :", ESTADOS[Number(lote.estado)]);
  console.log("Incidencia      :", lote.incidencia);
  console.log("Custodio actual :", await formatearActor(contrato, lote.custodioActual));
  console.log("Hash documento  :", lote.hashDocumento);
 
  console.log(`\nHistorial de custodios (${custodios.length}):`);
  for (let i = 0; i < custodios.length; i++) {
    console.log(`  [${i + 1}] ${await formatearActor(contrato, custodios[i])}`);
  }
 
  console.log(`\nLecturas de temperatura (${temperaturas.length}):`);
  for (let i = 0; i < temperaturas.length; i++) {
    const t = temperaturas[i];
    const grados = (Number(t.temperatura) / 100).toFixed(2);
    const actor = await formatearActor(contrato, t.registradoPor);
    console.log(`  [${i + 1}] ${grados}°C | excesiva: ${t.excesiva} | registrado por: ${actor}`);
  }
}
 
main().catch((error) => {
  console.error(error);
  process.exit(1);
});