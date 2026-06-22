pragma solidity ^0.8.20;

contract Trazabilidad {
    // Roles:
    bytes32 public constant FABRICANTE = keccak256("FABRICANTE");
    bytes32 public constant LOGISTICA = keccak256("LOGISTICA");
    bytes32 public constant DISTRIBUIDOR = keccak256("DISTRIBUIDOR");
    bytes32 public constant FARMACIA = keccak256("FARMACIA");
    bytes32 public constant REGULADOR = keccak256("REGULADOR");
    bytes32 public constant ADMINISTRADOR = keccak256("ADMINISTRADOR");

    // Estado del lote
    enum Estado {
        Creado,
        EnTransito,
        Recibido,
        Dispensado,
        Comprometido
    }

    // Estructura del lote
    struct Lote {
        bytes32 IDLote;
        string nombreMedicamento;
        uint256 fechaFabricacion;
        uint256 fechaCaducidad;
        address custodioActual;
        Estado estado;
        bool incidencia; //verdadero si se registra una temperatura fuera del rango
        bytes32 hashDocumento;
    }

    // Temperatura
    struct LecturaTemperatura {
        uint256 timestamp;
        int256 temperatura;
        address registradoPor;
        bool excesiva;
    }

    // Anclaje de los hashes SHA-256 de los CSVs off-chain (lotes, temperaturas, operaciones)
    struct SnapshotHashes {
        bytes32 hashLotes;
        bytes32 hashTemperaturas;
        bytes32 hashOperaciones;
        uint256 timestamp;
        address registradoPor;
    }

    // Diccionarios
    mapping(bytes32 => Lote) public lotes;
    mapping(bytes32 => LecturaTemperatura[]) public temperaturas;
    mapping(bytes32 => address[]) public historialCustodios;
    mapping(address => bytes32) public roles;

    // Historial de snapshots de hashes registrados (uno por cada simulación/ejecución)
    SnapshotHashes[] public snapshots;

    // Eventos
    event LoteCreado(bytes32 indexed IDLote, address fabricante, uint256 timestamp);
    event CustodiaTransferida(bytes32 indexed IDLote, address de, address hacia, uint256 timestamp);
    event RecepcionConfirmada(bytes32 indexed IDLote, address receptor, uint256 timestamp);
    event TemperaturaRegistrada(bytes32 indexed IDLote, int256 temperatura, bool excesiva, uint256 timestamp);
    event LoteComprometido(bytes32 indexed IDLote, address reportadoPor, uint256 timestamp);
    event LoteDispensado(bytes32 indexed IDLote, address farmacia, uint256 timestamp);
    event HashesRegistrados(uint256 indexed indiceSnapshot, bytes32 hashLotes, bytes32 hashTemperaturas, bytes32 hashOperaciones, uint256 timestamp);

    // Modificacion, antes de ejecutar una accion comprueba si el actor tiene permiso
    modifier soloRol(bytes32 rol) {
        require(roles[msg.sender] == rol, "No tienes permiso para esta accion");
        _;
    }

    // Comprueba si el lote existe, si la fecha de fabricacion es 0 el lote no existe
    modifier loteExiste(bytes32 IDLote) {
        require(lotes[IDLote].fechaFabricacion != 0, "El lote de medicamentos no existe");
        _;
    }

    // Asigna el rol de Administrador a quien despliega el contrato por primera vez
    constructor() {
        roles[msg.sender] = ADMINISTRADOR;
    }

    // Asignar Roles, solo lo puede hacer el Administrador
    function asignarRol(address actor, bytes32 rol) public soloRol(ADMINISTRADOR) {
        roles[actor] = rol;
    }

    // 1 Crear el Lote
    function crearLote(
        bytes32 IDLote,
        string memory nombreMedicamento,
        uint256 fechaFabricacion,
        uint256 fechaCaducidad,
        bytes32 hashDocumento

    ) public soloRol(FABRICANTE) {
        require(lotes[IDLote].fechaFabricacion == 0, "El lote de medicamentos ya existe"); // antes de fabricarlo la fecha debe ser 0

        lotes[IDLote] = Lote({
            IDLote: IDLote,
            nombreMedicamento: nombreMedicamento,
            fechaFabricacion: fechaFabricacion,
            fechaCaducidad: fechaCaducidad,
            custodioActual: msg.sender,
            estado: Estado.Creado,
            incidencia: false,
            hashDocumento: hashDocumento
        });

        historialCustodios[IDLote].push(msg.sender);
        emit LoteCreado(IDLote, msg.sender, block.timestamp);
    }

    // 2 Transferencia de Custodia 
    function transferirCustodia(
        bytes32 IDLote,
        address nuevoCustodio
    ) public loteExiste(IDLote) {
        require(
            roles[msg.sender] == FABRICANTE ||
            roles[msg.sender] == LOGISTICA ||
            roles[msg.sender] == DISTRIBUIDOR,
            "No puedes transferir este lote"
        );
        require(lotes[IDLote].custodioActual == msg.sender, "No eres el custodio actual"); // verifica que el lote lo transfiere el propietario actual
        require(lotes[IDLote].estado != Estado.Comprometido, "El lote de medicamentos esta comprometido"); // verifica que el lote no ha sufrido ninguna incidencia 

        // Verifica que el nuevo custodio tiene el rol que le corresponde
        // segun el orden real de la cadena de suministro: cada eslabon solo
        // puede entregar el lote al siguiente eslabon, nunca a otro distinto.
        bytes32 rolEsperado;
        if (roles[msg.sender] == FABRICANTE) {
            rolEsperado = LOGISTICA;
        } else if (roles[msg.sender] == LOGISTICA) {
            rolEsperado = DISTRIBUIDOR;
        } else {
            // roles[msg.sender] == DISTRIBUIDOR
            rolEsperado = FARMACIA;
        }
        require(roles[nuevoCustodio] == rolEsperado, "El nuevo custodio no tiene el rol que corresponde en la cadena");

        lotes[IDLote].custodioActual = nuevoCustodio;
        lotes[IDLote].estado = Estado.EnTransito;
        historialCustodios[IDLote].push(nuevoCustodio);

        emit CustodiaTransferida(IDLote, msg.sender, nuevoCustodio, block.timestamp);
    }

    // 3 Confirmar Recepcion
    function confirmarRecepcion(
        bytes32 IDLote
    ) public loteExiste(IDLote) {
        require(lotes[IDLote].custodioActual == msg.sender, "No eres el custodio actual");
        require(lotes[IDLote].estado == Estado.EnTransito, "El lote de medicamentos no esta en transito");

        lotes[IDLote].estado = Estado.Recibido;

        emit RecepcionConfirmada(IDLote, msg.sender, block.timestamp);
    }

    // 4 Registrar Temperatura
    function registrarTemperatura(
        bytes32 IDLote,
        int256 temperatura
    ) public loteExiste(IDLote) {
        require(
            roles[msg.sender] == LOGISTICA ||
            roles[msg.sender] == DISTRIBUIDOR,
            "No puedes registrar temperatura"
        );
        require(lotes[IDLote].estado != Estado.Comprometido, "El lote de medicamentos esta comprometido");

        bool excesiva = (temperatura < 200 || temperatura > 800); 

        if (excesiva) {
            lotes[IDLote].incidencia = true; // se sale del rango hay una incidencia de temperatura
        }

        bool excursionSevera = (temperatura < 0 || temperatura > 1000); // si se sale mas de 10ºC o menos de 0ºC el estado del producto esta comprometido

        if (excursionSevera) {
            lotes[IDLote].estado = Estado.Comprometido;
            emit LoteComprometido(IDLote, msg.sender, block.timestamp);
        }

        temperaturas[IDLote].push(LecturaTemperatura({
            timestamp: block.timestamp,
            temperatura: temperatura,
            registradoPor: msg.sender,
            excesiva: excesiva
        }));

        emit TemperaturaRegistrada(IDLote, temperatura, excesiva, block.timestamp);
    }

    // 5 Producto que se debe retirar, solo el regulador lo puede retirar
    function marcarComprometido(
        bytes32 IDLote
    ) public loteExiste(IDLote) soloRol(REGULADOR) {
        require(lotes[IDLote].estado != Estado.Comprometido, "El lote de medicamentos ya esta comprometido");

        lotes[IDLote].estado = Estado.Comprometido;
        lotes[IDLote].incidencia = true;

        emit LoteComprometido(IDLote, msg.sender, block.timestamp);
    }  

    // 6 Dispensar lote al paciente
    function dispensarLote(
        bytes32 IDLote
    ) public loteExiste(IDLote) soloRol(FARMACIA) {
        require(lotes[IDLote].custodioActual == msg.sender, "No eres el custodio actual"); // solo la Farmacia puede dispensar el lote
        require(lotes[IDLote].estado == Estado.Recibido, "El lote de medicamnetos no esta recibido"); // el lote tiene que haber sido recibido
        require(lotes[IDLote].estado != Estado.Comprometido, "El lote de medicamentos esta comprometido"); // el lote se ha tenido que almacenar de manera adecuada

        lotes[IDLote].estado = Estado.Dispensado;

        emit LoteDispensado(IDLote, msg.sender, block.timestamp);
    } 

    // 7 Obtener Historial de un lote de medicamentos
    function obtenerHistorial(
        bytes32 IDLote
    ) public view loteExiste(IDLote) returns (
        Lote memory,
        LecturaTemperatura[] memory,
        address[] memory
    ) {
        return (
            lotes[IDLote],
            temperaturas[IDLote],
            historialCustodios[IDLote]
        );
    } 

    // 8 Registrar (anclar) los hashes SHA-256 de los CSVs off-chain de una simulacion
    function registrarHashes(
        bytes32 hashLotes,
        bytes32 hashTemperaturas,
        bytes32 hashOperaciones
    ) public soloRol(ADMINISTRADOR) {
        snapshots.push(SnapshotHashes({
            hashLotes: hashLotes,
            hashTemperaturas: hashTemperaturas,
            hashOperaciones: hashOperaciones,
            timestamp: block.timestamp,
            registradoPor: msg.sender
        }));

        emit HashesRegistrados(snapshots.length - 1, hashLotes, hashTemperaturas, hashOperaciones, block.timestamp);
    }

    // 9 Obtener el numero total de snapshots de hashes registrados
    function totalSnapshots() public view returns (uint256) {
        return snapshots.length;
    }

    // 10 Obtener el ultimo snapshot de hashes registrado
    function obtenerUltimoSnapshot() public view returns (SnapshotHashes memory) {
        require(snapshots.length > 0, "No hay snapshots de hashes registrados");
        return snapshots[snapshots.length - 1];
    }

    }
