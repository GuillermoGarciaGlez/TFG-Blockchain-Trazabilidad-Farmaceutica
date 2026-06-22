const hre = require("hardhat");
const { keccak256, toUtf8Bytes } = require("ethers");
const crypto = require("crypto");
const { createObjectCsvWriter } = require("csv-writer");
const fs = require("fs");

// Utilidades
function tempAleatoria(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generarLecturas(escenario) {
  const lecturas = [];
  const n = 4 + Math.floor(Math.random() * 4); // entre 4 y 7 lecturas por lote

  const indicePico = Math.floor(Math.random() * n);

  for (let i = 0; i < n; i++) {
    let temp;
    if (escenario === "normal") {
      temp = tempAleatoria(210, 790);           // 2.1°C – 7.9°C ✓
    } else if (escenario === "excursion_leve") {
      temp = i === indicePico ? tempAleatoria(801, 999) : tempAleatoria(210, 790); // 1 pico leve
    } else if (escenario === "excursion_severa") {
      temp = i === indicePico ? tempAleatoria(1001, 1500) : tempAleatoria(210, 790); // 1 pico severo
    } else if (escenario === "frio_severo") {
      temp = i === indicePico ? tempAleatoria(-300, -1) : tempAleatoria(210, 790);  // congelación
    }
    lecturas.push(temp);
  }
  return lecturas;
}

// Helper para registrar cada operación en el array de operaciones
function registrarOperacion(registrosOps, lote, operacion, actor, receipt) {
  registrosOps.push({
    lote: lote,
    operacion: operacion,
    actor: actor,
    gasUsado: receipt.gasUsed.toString(),
    blockNumber: receipt.blockNumber
  });
}

// Main 
async function main() {
  const [admin, fabricante, logistica, distribuidor, farmacia, regulador] =
    await hre.ethers.getSigners();

  const direccionContrato = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const Trazabilidad = await hre.ethers.getContractFactory("Trazabilidad");
  const contrato = Trazabilidad.attach(direccionContrato);

  // Asignar roles
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
  console.log("Roles asignados.");

  // Definir los 100 lotes
  const medicamentos = [
    "Insulina",
    "Vacuna A",
    "Vacuna B",
    "Antibiotico",
    "Antimalarico"
  ];

  // Asignación probabilística e independiente por lote (no determinista):
  // cada lote tiene un 70% de probabilidad de ser "normal", 16% "excursion leve",
  // 11% "excursion severa" y 3% "frio severo".
  function elegirEscenario() {
    const r = Math.random(); // numero entre 0 y 1
    if (r < 0.70) return "normal";
    if (r < 0.86) return "excursion_leve";      
    if (r < 0.97) return "excursion_severa";     
    return "frio_severo";                        
  }

  const registrosLotes = [];
  const registrosTemps = [];
  const registrosOps   = [];

  const ahora = Math.floor(Date.now() / 1000);

  console.log("\nIniciando simulación de 100 lotes\n");

  for (let i = 0; i < 100; i++) {
    const numLote     = String(i + 1).padStart(3, "0");
    const med         = medicamentos[i % medicamentos.length];
    const escenario   = elegirEscenario();
    const IDLoteStr   = `LOTE-${numLote}`;
    const IDLote      = keccak256(toUtf8Bytes(IDLoteStr));
    const hashDoc     = keccak256(toUtf8Bytes(`doc-calidad-${IDLoteStr}`));
    const caducidad   = ahora + 60 * 60 * 24 * 365;

    // Crear lote
    const txCrear = await (await contrato.connect(fabricante).crearLote(
      IDLote, med, ahora, caducidad, hashDoc
    )).wait();
    registrarOperacion(registrosOps, IDLoteStr, "crearLote", "Fabricante", txCrear);

    // Fabricante a Logística
    const txTransf1 = await (await contrato.connect(fabricante).transferirCustodia(IDLote, logistica.address)).wait();
    registrarOperacion(registrosOps, IDLoteStr, "transferirCustodia", "Fabricante", txTransf1);

    // Lecturas de temperatura (Logística)
    const lecturasLogistica = generarLecturas(escenario);
    let comprometidoYa = false;
    for (const temp of lecturasLogistica) {
      if (comprometidoYa) break;
      const txTemp = await (await contrato.connect(logistica).registrarTemperatura(IDLote, temp)).wait();
      registrarOperacion(registrosOps, IDLoteStr, "registrarTemperatura", "Logistica", txTemp);
      if (temp < 0 || temp > 1000) comprometidoYa = true;
      registrosTemps.push({
        lote: IDLoteStr,
        medicamento: med,
        escenario,
        actor: "Logistica",
        temperatura_raw: temp,
        temperatura_c: (temp / 100).toFixed(2),
        excesiva: (temp < 200 || temp > 800) ? "true" : "false",
        comprometido: (temp < 0 || temp > 1000) ? "true" : "false",
        block: txTemp.blockNumber,
        gasUsado: txTemp.gasUsed.toString()
      });
    }

    // Comprobar si el lote quedó comprometido despes de las lecturas
    const loteInfo = await contrato.lotes(IDLote);
    const estadoTrasTemp = Number(loteInfo.estado);

    let estadoFinal;

    if (estadoTrasTemp === 4) {
      // Lote comprometido automáticamente por temperatura severa
      estadoFinal = "Comprometido";
    } else {
      // Logística confirma y transfiere a Distribuidor
      const txConf1 = await (await contrato.connect(logistica).confirmarRecepcion(IDLote)).wait();
      registrarOperacion(registrosOps, IDLoteStr, "confirmarRecepcion", "Logistica", txConf1);

      const txTransf2 = await (await contrato.connect(logistica).transferirCustodia(IDLote, distribuidor.address)).wait();
      registrarOperacion(registrosOps, IDLoteStr, "transferirCustodia", "Logistica", txTransf2);

      // Lecturas Distribuidor (mismo escenario real del lote, ya que las
      const lecturasDistribuidor = generarLecturas(escenario);
      let comprometidoYaDistribuidor = false;
      for (const temp of lecturasDistribuidor) {
        if (comprometidoYaDistribuidor) break;
        const txTemp = await (await contrato.connect(distribuidor).registrarTemperatura(IDLote, temp)).wait();
        registrarOperacion(registrosOps, IDLoteStr, "registrarTemperatura", "Distribuidor", txTemp);
        if (temp < 0 || temp > 1000) comprometidoYaDistribuidor = true;
        registrosTemps.push({
          lote: IDLoteStr,
          medicamento: med,
          escenario,
          actor: "Distribuidor",
          temperatura_raw: temp,
          temperatura_c: (temp / 100).toFixed(2),
          excesiva: (temp < 200 || temp > 800) ? "true" : "false",
          comprometido: (temp < 0 || temp > 1000) ? "true" : "false",
          block: txTemp.blockNumber,
          gasUsado: txTemp.gasUsed.toString()
        });
      }

      // Comprobar si el lote quedó comprometido también en el tramo del Distribuidor
      const loteInfoDistribuidor = await contrato.lotes(IDLote);
      const estadoTrasDistribuidor = Number(loteInfoDistribuidor.estado);

      if (estadoTrasDistribuidor === 4) {
        estadoFinal = "Comprometido";
      } else {
        // Distribuidor a Farmacia
        const txConf2 = await (await contrato.connect(distribuidor).confirmarRecepcion(IDLote)).wait();
        registrarOperacion(registrosOps, IDLoteStr, "confirmarRecepcion", "Distribuidor", txConf2);

        const txTransf3 = await (await contrato.connect(distribuidor).transferirCustodia(IDLote, farmacia.address)).wait();
        registrarOperacion(registrosOps, IDLoteStr, "transferirCustodia", "Distribuidor", txTransf3);

        // Farmacia confirma y dispensa
        const txConf3 = await (await contrato.connect(farmacia).confirmarRecepcion(IDLote)).wait();
        registrarOperacion(registrosOps, IDLoteStr, "confirmarRecepcion", "Farmacia", txConf3);

        const txDispensar = await (await contrato.connect(farmacia).dispensarLote(IDLote)).wait();
        registrarOperacion(registrosOps, IDLoteStr, "dispensarLote", "Farmacia", txDispensar);

        estadoFinal = "Dispensado";
      }
    }

    // loteInfo final para el registro en lotes.csv: si el lote se comprometió
    const loteInfoFinal = await contrato.lotes(IDLote);

    // Gas de la transacción de creación
    const gasCrear = txCrear.gasUsed.toString();

    registrosLotes.push({
      lote: IDLoteStr,
      medicamento: med,
      escenario,
      estado_final: estadoFinal,
      incidencia: loteInfoFinal.incidencia.toString(),
      gas_crear_lote: gasCrear,
      block_creacion: txCrear.blockNumber
    });

    console.log(`[${numLote}/100] ${IDLoteStr} | ${escenario.padEnd(16)} | ${estadoFinal}`);
  }

  // Exportar CSVs off-chain 
  if (!fs.existsSync("data")) fs.mkdirSync("data");

  const csvLotes = createObjectCsvWriter({
    path: "data/lotes.csv",
    header: [
      { id: "lote",          title: "Lote" },
      { id: "medicamento",   title: "Medicamento" },
      { id: "escenario",     title: "Escenario" },
      { id: "estado_final",  title: "EstadoFinal" },
      { id: "incidencia",    title: "Incidencia" },
      { id: "gas_crear_lote",title: "GasCrearLote" },
      { id: "block_creacion",title: "BlockCreacion" }
    ]
  });

  const csvTemps = createObjectCsvWriter({
    path: "data/temperaturas.csv",
    header: [
      { id: "lote",           title: "Lote" },
      { id: "medicamento",    title: "Medicamento" },
      { id: "escenario",      title: "Escenario" },
      { id: "actor",          title: "Actor" },
      { id: "temperatura_raw",title: "TempRaw" },
      { id: "temperatura_c",  title: "TempC" },
      { id: "excesiva",       title: "Excesiva" },
      { id: "comprometido",   title: "Comprometido" },
      { id: "block",          title: "Block" },
      { id: "gasUsado",       title: "GasUsado" }
    ]
  });

  const csvOps = createObjectCsvWriter({
    path: "data/operaciones.csv",
    header: [
      { id: "lote",        title: "Lote" },
      { id: "operacion",   title: "Operacion" },
      { id: "actor",       title: "Actor" },
      { id: "gasUsado",    title: "GasUsado" },
      { id: "blockNumber", title: "BlockNumber" }
    ]
  });

  await csvLotes.writeRecords(registrosLotes);
  await csvTemps.writeRecords(registrosTemps);
  await csvOps.writeRecords(registrosOps);
  console.log("\nCSVs exportados: data/lotes.csv, data/temperaturas.csv y data/operaciones.csv");

  // Hash SHA-256 de los CSVs y registro on-chain
  const hashLotes = crypto.createHash("sha256")
    .update(fs.readFileSync("data/lotes.csv")).digest("hex");
  const hashTemps = crypto.createHash("sha256")
    .update(fs.readFileSync("data/temperaturas.csv")).digest("hex");
  const hashOps = crypto.createHash("sha256")
    .update(fs.readFileSync("data/operaciones.csv")).digest("hex");

  console.log("\nHash SHA-256 lotes.csv        :", hashLotes);
  console.log("Hash SHA-256 temperaturas.csv :", hashTemps);
  console.log("Hash SHA-256 operaciones.csv  :", hashOps);

  // Anclar los hashes en la blockchain 
  // Hay que añadirles el prefijo "0x" para que Solidity los acepte como bytes32.
  const hashLotesBytes32 = "0x" + hashLotes;
  const hashTempsBytes32 = "0x" + hashTemps;
  const hashOpsBytes32   = "0x" + hashOps;

  const txHashes = await (await contrato.connect(admin).registrarHashes(
    hashLotesBytes32, hashTempsBytes32, hashOpsBytes32
  )).wait();

  console.log("\nHashes anclados on-chain en el bloque:", txHashes.blockNumber);
  console.log("Gas usado en registrarHashes        :", txHashes.gasUsed.toString());

  // Guardamos los hashes en un JSON local
  fs.writeFileSync("data/hashes.json", JSON.stringify({
    lotes_csv:        hashLotes,
    temperaturas_csv:  hashTemps,
    operaciones_csv:   hashOps,
    timestamp:         new Date().toISOString(),
    anclaje_onchain: {
      blockNumber: txHashes.blockNumber,
      gasUsado: txHashes.gasUsed.toString(),
      transactionHash: txHashes.hash
    }
  }, null, 2));

  console.log("\nHashes guardados en data/hashes.json");
  console.log("\nSIMULACIÓN COMPLETADA");
  console.log(`Lotes simulados      : 100`);
  console.log(`Registros de temp    : ${registrosTemps.length}`);
  console.log(`Registros de operac. : ${registrosOps.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});