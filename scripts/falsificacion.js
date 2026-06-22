const hre = require("hardhat");
const { keccak256, toUtf8Bytes } = require("ethers");

async function intentar(descripcion, promesa) {
  process.stdout.write(`  → ${descripcion}... `);
  try {
    await (await promesa).wait();
    console.log("✓ PERMITIDO");
    return true;
  } catch (e) {
    const motivo = e.message.match(/reverted with reason string '(.+?)'/)?.[1] || "revert";
    console.log(`✗ BLOQUEADO: "${motivo}"`);
    return false;
  }
}

async function main() {
  const [admin, fabricante, logistica, distribuidor, farmacia, regulador,
         atacante1, atacante2] = await hre.ethers.getSigners();

  const direccionContrato = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Cambiar direccion del contrato
  const Trazabilidad = await hre.ethers.getContractFactory("Trazabilidad");
  const contrato = Trazabilidad.attach(direccionContrato);

  // Roles legítimos
  const ROL_FABRICANTE   = keccak256(toUtf8Bytes("FABRICANTE"));
  const ROL_LOGISTICA    = keccak256(toUtf8Bytes("LOGISTICA"));
  const ROL_DISTRIBUIDOR = keccak256(toUtf8Bytes("DISTRIBUIDOR"));
  const ROL_FARMACIA     = keccak256(toUtf8Bytes("FARMACIA"));
  const ROL_REGULADOR    = keccak256(toUtf8Bytes("REGULADOR"));

  await (await contrato.connect(admin).asignarRol(fabricante.address,   ROL_FABRICANTE)).wait();
  await (await contrato.connect(admin).asignarRol(logistica.address,    ROL_LOGISTICA)).wait();
  await (await contrato.connect(admin).asignarRol(distribuidor.address, ROL_DISTRIBUIDOR)).wait();
  await (await contrato.connect(admin).asignarRol(farmacia.address,     ROL_FARMACIA)).wait();
  await (await contrato.connect(admin).asignarRol(regulador.address,    ROL_REGULADOR)).wait();

  const ahora     = Math.floor(Date.now() / 1000);
  const caducidad = ahora + 60 * 60 * 24 * 365;

  // ESCENARIO A: Introducir lote falsificado sin rol
  console.log("ESCENARIO A: Atacante intenta crear un lote falsificado");

  const IDFalso = keccak256(toUtf8Bytes("LOTE-FALSO-001"));
  const hashFalso = keccak256(toUtf8Bytes("documento-falso"));

  await intentar(
    "Atacante sin rol intenta crear lote",
    contrato.connect(atacante1).crearLote(IDFalso, "Medicamento Falso", ahora, caducidad, hashFalso)
  );

  await intentar(
    "Logística intenta crear lote (rol incorrecto)",
    contrato.connect(logistica).crearLote(IDFalso, "Medicamento Falso", ahora, caducidad, hashFalso)
  );

  // ESCENARIO B: Crear lote legítimo y atacar la cadena de custodia
  console.log("ESCENARIO B: Ataque a la cadena de custodia");

  const IDLegitimo = keccak256(toUtf8Bytes("LOTE-LEGITIMO-TEST"));
  await (await contrato.connect(fabricante).crearLote(
    IDLegitimo, "Vacuna B", ahora, caducidad, hashFalso
  )).wait();
  console.log("  [OK] Lote legítimo creado por Fabricante.");

  await (await contrato.connect(fabricante).transferirCustodia(IDLegitimo, logistica.address)).wait();
  console.log("  [OK] Custodia transferida a Logística.");

  await intentar(
    "Atacante intenta transferir custodia sin ser custodio",
    contrato.connect(atacante1).transferirCustodia(IDLegitimo, atacante2.address)
  );

  await intentar(
    "Distribuidor intenta transferir custodia (no es custodio actual)",
    contrato.connect(distribuidor).transferirCustodia(IDLegitimo, farmacia.address)
  );

  await intentar(
    "Logística (custodio legítimo) se vuelve corrupto e intenta desviar el lote a un atacante",
    contrato.connect(logistica).transferirCustodia(IDLegitimo, atacante1.address)
  );

  // ESCENARIO C: Dispensar lote comprometido
  console.log("ESCENARIO C: Intento de dispensar lote comprometido");

  const IDComp = keccak256(toUtf8Bytes("LOTE-COMPROMETIDO-TEST"));
  await (await contrato.connect(fabricante).crearLote(
    IDComp, "Insulina", ahora, caducidad, hashFalso
  )).wait();
  await (await contrato.connect(fabricante).transferirCustodia(IDComp, logistica.address)).wait();
  await (await contrato.connect(logistica).registrarTemperatura(IDComp, 1500)).wait(); // severa → Comprometido
  console.log("Lote forzado a estado Comprometido por temperatura 15°C.");

  await intentar(
    "Logística intenta confirmar recepción de un lote ya comprometido",
    contrato.connect(logistica).confirmarRecepcion(IDComp)
  );

  await intentar(
    "Logística intenta transferir lote comprometido",
    contrato.connect(logistica).transferirCustodia(IDComp, distribuidor.address)
  );

  // ESCENARIO D: Regulador marca lote sospechoso
  console.log("ESCENARIO D: Regulador interviene y marca lote sospechoso");

  const IDSosp = keccak256(toUtf8Bytes("LOTE-SOSPECHOSO-TEST"));
  await (await contrato.connect(fabricante).crearLote(
    IDSosp, "Antibiotico", ahora, caducidad, hashFalso
  )).wait();
  await (await contrato.connect(fabricante).transferirCustodia(IDSosp, logistica.address)).wait();
  await (await contrato.connect(logistica).confirmarRecepcion(IDSosp)).wait();
  await (await contrato.connect(logistica).transferirCustodia(IDSosp, distribuidor.address)).wait();

  await intentar(
    "Atacante intenta marcar lote como comprometido (sin rol Regulador)",
    contrato.connect(atacante1).marcarComprometido(IDSosp)
  );

  await intentar(
    "Regulador marca lote sospechoso como comprometido",
    contrato.connect(regulador).marcarComprometido(IDSosp)
  );

  await intentar(
    "Distribuidor intenta transferir lote ya comprometido por Regulador",
    contrato.connect(distribuidor).transferirCustodia(IDSosp, farmacia.address)
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});