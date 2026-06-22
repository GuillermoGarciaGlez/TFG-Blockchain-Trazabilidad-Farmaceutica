const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Desplegando contrato con la cuenta:", deployer.address);

  const Trazabilidad = await hre.ethers.getContractFactory("Trazabilidad");
  const contrato = await Trazabilidad.deploy();
  await contrato.waitForDeployment();

  const direccion = await contrato.getAddress();
  console.log("Contrato desplegado en:", direccion);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});