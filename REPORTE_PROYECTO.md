# Reporte del proyecto: plataforma multiempresa de reservas de canchas

## Introducción

Este proyecto evolucionó desde un sistema académico inicial hacia una plataforma
para la gestión y reserva de canchas deportivas. La propuesta busca resolver una
necesidad muy concreta de clubes, complejos y empresas deportivas: administrar
sus espacios, organizar la disponibilidad y permitir que una persona encuentre
una cancha adecuada y reserve un horario sin depender de coordinaciones
manuales.

El resultado es un sistema multiempresa. Cada organización conserva sus propias
canchas, deportes, precios, bloques de reserva, usuarios operativos y reglas de
uso. A la vez, la plataforma contempla un problema habitual en este tipo de
negocio: una misma superficie física puede utilizarse como una cancha grande o
dividirse en varias canchas más pequeñas. Por ejemplo, una cancha de fútbol de
11 puede ofrecerse como varias canchas de fútbol reducido, sin permitir reservas
que se superpongan físicamente.

La aplicación combina una parte pública, orientada a quien busca reservar, con
un panel de operación para las empresas. Así, no es solamente un catálogo de
canchas: es una herramienta para administrar disponibilidad real, evitar
conflictos y ordenar el trabajo cotidiano.

## Qué hicimos

Se reemplazó la superficie activa del modelo anterior de alumnos, materias e
inscripciones por un modelo de negocio centrado en empresas deportivas y
reservas. El sistema final permite:

- Registrar y administrar múltiples empresas deportivas de forma independiente.
- Definir los deportes que ofrece cada empresa.
- Crear canchas, asociarlas a un deporte y configurar su precio por hora.
- Configurar bloques de tiempo reservables, por ejemplo 60, 90 o 120 minutos.
- Aplicar reglas de partición para transformar una cancha grande en subcanchas.
- Visualizar un mapa de disponibilidad por empresa, deporte, día y duración.
- Generar reservas temporales y confirmarlas desde el panel operativo.
- Crear cuentas para usuarios de operación y asignarles permisos por empresa.
- Ofrecer un flujo público para consultar disponibilidad y dejar una reserva en
  espera, incluso sin iniciar sesión.
- Permitir que los clientes creen su cuenta, consulten sus reservas y cancelen
  aquellas que todavía no comenzaron.

También se trabajó la experiencia de uso. Los formularios guían el orden lógico
de las decisiones: primero se selecciona la empresa, luego el deporte y recién
después los formatos de cancha compatibles. Las reglas de partición se muestran
con nombres y una vista previa en lugar de pedir JSON técnico. En tablas y
selectores se priorizan nombres legibles, sin exponer identificadores internos.

## Cómo lo hicimos

El proyecto se desarrolló extendiendo la estructura que ya existía, sin
reemplazarla por una arquitectura paralela. Se mantuvo el backend en Node.js,
TypeScript y Express; PostgreSQL como base de datos; y un frontend en TypeScript
con HTML y CSS. Los datos simples se administran mediante el CRUD genérico que
ya tenía el sistema, mientras que los casos que requieren reglas de negocio
propias, como la disponibilidad, la partición y las reservas, se resolvieron
con endpoints específicos.

La base se fue evolucionando mediante migraciones. Esto permite que el esquema
cambie de forma ordenada y reproducible sin alterar versiones históricas ya
aplicadas. En lugar de editar el pasado, cada mejora importante se incorporó
como una nueva migración: el modelo de canchas y reservas, la eliminación del
modelo académico, las reglas de partición, las protecciones contra reservas
superpuestas, el refuerzo multiempresa y las cuentas de clientes.

Para evitar que una reserva deje datos incompletos ante un error, las operaciones
críticas se realizan como transacciones. En términos simples, crear una reserva,
sus bloqueos asociados y su importe ocurre como una única acción: si una parte
falla, se revierte todo. Además, el sistema bloquea los espacios físicos
afectados para impedir solapamientos entre una cancha principal y sus
subcanchas.

La disponibilidad se calcula considerando la zona horaria de cada empresa, los
bloques de tiempo habilitados y los precios vigentes para la fecha de la
reserva. Cuando un espacio grande se divide, la lógica permite que las canchas
hermanas compatibles continúen disponibles. A su vez, se aplica una regla de
antifragmentación: antes de abrir otro grupo físico, el sistema intenta llenar
el grupo que ya tiene una reserva. Esto aprovecha mejor el espacio y evita
inutilizar una cancha grande prematuramente.

El historial de Git y las bitácoras de implementación muestran una construcción
incremental: primero se incorporó el dominio de reservas; luego se mejoraron los
flujos de empresas, deportes y canchas; más tarde se reforzaron permisos,
aislamiento entre empresas, horarios, precios, paneles operativos y cuentas de
cliente. Las auditorías documentadas permitieron detectar casos como filtros de
datos entre empresas, diferencias de zona horaria, precios inexistentes,
selectores limitados y estados visuales poco claros, y corregirlos sin realizar
reescrituras amplias.

## Directivas de trabajo utilizadas

El desarrollo siguió un conjunto de directivas para mantener el proyecto claro,
seguro y revisable:

- Se hicieron cambios puntuales sobre los archivos y patrones existentes,
  evitando refactors ajenos al objetivo.
- Se reutilizó el CRUD genérico para entidades simples y se agregaron módulos
  específicos solo para reglas reales del dominio.
- Se mantuvo una única fuente de verdad para estructuras, etiquetas y opciones
  compartidas entre la interfaz y el dominio.
- La identidad se separó de los datos de negocio: los usuarios viven en el
  esquema de autenticación y las empresas, canchas y reservas en el modelo
  operativo.
- No se agregaron dependencias productivas innecesarias. Por ejemplo, las
  contraseñas usan `crypto.scrypt` nativo y el límite de holds públicos se
  implementó de forma simple, sin incorporar una biblioteca adicional.
- Las sesiones usan cookies HttpOnly con tokens opacos. La base de datos guarda
  solamente el hash del token, nunca el token en texto plano.
- Se evitó registrar contraseñas, hashes, sales, cookies o tokens en logs y
  auditorías.
- Las migraciones se trataron como forward-only: no se alteraron migraciones
  históricas, incluso cuando todavía mencionan el modelo académico eliminado.
- Se añadieron pruebas enfocadas en las reglas de mayor riesgo, especialmente
  particiones, permisos por empresa, reservas incompatibles y flujos de
  autenticación.

## Decisiones de diseño de la aplicación

La decisión principal fue diseñar la plataforma alrededor del espacio físico y
no solamente de una lista plana de canchas. Cada cancha puede pertenecer a un
árbol: una cancha principal y sus subcanchas. Esto hace posible representar un
complejo real, donde el mismo espacio puede venderse de distintas maneras según
la demanda.

La partición se dejó como una acción explícita. Al crear o editar una cancha no
se generan divisiones nuevas de manera inesperada. Las subcanchas creadas
automáticamente comienzan sin capacidad de seguir particionándose; si una
empresa quiere dividir una de ellas, primero debe marcarla como particionable y
luego aplicar una regla de forma consciente. Esta decisión privilegia la
claridad y evita cambios físicos difíciles de interpretar.

Otra decisión importante fue separar los tipos de usuario. El administrador
global administra la plataforma completa. Los usuarios vinculados a una empresa
pueden tener rol de propietario, gerente, personal operativo o solo lectura.
En paralelo, los clientes tienen sus propias cuentas para reservar, consultar y
cancelar turnos. Esta separación refleja que quien opera un complejo no tiene
las mismas necesidades ni permisos que quien busca jugar.

Se decidió que la disponibilidad sea pública para facilitar la conversión: una
persona puede explorar empresas, deportes, horarios y canchas sin fricción. El
primer paso de reserva genera un hold con vencimiento breve; la confirmación y
cancelación quedan bajo control de usuarios autenticados con permisos sobre la
empresa. Así se equilibra una experiencia accesible para el cliente con control
operativo para el negocio.

En la interfaz se eligió una estética de dashboard sobria y responsive. El
contenido se organiza en encabezado, navegación, formularios y tarjetas de
información; los estados de disponibilidad se diferencian visualmente; y las
acciones importantes quedan cerca del contexto donde se necesitan. La intención
fue que una persona pueda entender el flujo sin conocer detalles técnicos de la
base de datos.

## Seguridad y calidad

La autenticación contempla contraseñas de al menos doce caracteres, con
mayúscula, minúscula y número. La misma regla se reutiliza al crear usuarios,
cambiar contraseñas, restablecerlas o preparar el administrador inicial. Las
sesiones se resuelven de forma segura mediante cookies HttpOnly y tokens opacos
hasheados.

En el plano de datos, se incorporaron validaciones de empresa, deporte,
duración, precio y permisos antes de confirmar operaciones. Las reservas no
pueden superponerse sobre el mismo espacio físico y los usuarios de una empresa
no pueden modificar información de otra. También se validan los horarios contra
la grilla real de cada empresa y se evita confirmar turnos sin un precio válido.

El proyecto cuenta con pruebas de backend y frontend, además de compilaciones y
verificaciones con Docker. Estas pruebas cubren, entre otros casos, autenticación,
contraseñas, permisos entre empresas, distribución de canchas, aislamiento de
subcanchas, reglas de compactación y flujos de la interfaz.

## Conclusión

La plataforma entrega una base funcional y extensible para la gestión de
complejos deportivos. Resuelve la administración multiempresa, la operación de
canchas con divisiones físicas, la publicación de disponibilidad y la reserva
con controles de seguridad y consistencia.

Más allá de registrar turnos, el proyecto propone una forma de organizar mejor
el espacio disponible: permite vender una cancha grande o varias pequeñas sin
perder control sobre sus incompatibilidades. Con cuentas diferenciadas, roles
por empresa, precios, bloques horarios y un flujo público de reserva, el
sistema queda preparado para acompañar tanto la operación diaria de un club
pequeño como el crecimiento de una red de complejos deportivos.
