# Spec: sistema multiempresa de reservas de canchas

## Objetivo

Extender el proyecto actual para soportar reservas de canchas deportivas por
empresa, manteniendo la estructura existente: backend Express + PostgreSQL,
migraciones SQL forward-only, frontend TypeScript con SSOT compartida y CRUDs
genericos. La implementacion debe agregar las particularidades del dominio
sin reescribir los flujos base.

## Principios de implementacion

- Reutilizar la API generica `/api/:tableName` para entidades CRUD simples.
- Agregar endpoints especificos solo donde haya reglas de negocio que no
  encajan en CRUD: particionado automatico, disponibilidad y reserva.
- Mantener migraciones nuevas e inmutables en `database/migrations`.
- Extender `shared/src/ssot/structure.ts` solo con tablas administrables desde
  la UI.
- Mantener auth separado en `auth.users`; para multiempresa agregar permisos
  por empresa sin mezclar identidad con datos de negocio.
- Usar transacciones PostgreSQL para toda reserva y rollback ante cualquier
  error.
- Evitar dependencias productivas nuevas salvo que sean estrictamente
  necesarias.
- Mantener diffs chicos y revisables: cambios inline sobre archivos existentes,
  nuevos modulos solo cuando encapsulen reglas de negocio reales.

## Alcance funcional

1. Multiempresa: varias empresas, cada una con ubicacion, deportes, canchas,
   precios, horarios y reglas propias.
2. Multicancha: una cancha grande puede actuar como varias canchas chicas.
   Ejemplo: una cancha de 11 puede generar canchas de 8 y/o 5.
3. Particionado automatico: al cargar una cancha grande, el sistema crea sus
   subcanchas usando reglas de layout y optimizando el uso del espacio.
4. Mapa interactivo por empresa: muestra canchas, subcanchas, disponibilidad,
   horarios y precios.
5. Timeblocks: la empresa define duraciones reservables, por ejemplo 60, 90,
   120 o 180 minutos.
6. Guardas anti-overlap: no puede haber reservas superpuestas para la misma
   cancha ni para canchas que comparten espacio fisico incompatible.
7. Precio por hora por cancha.
8. Deportes configurables por empresa y por cancha.
9. Reserva con bloqueo temporal: cuando el cliente elige cancha y horario, se
   crea un hold que bloquea ese espacio hasta confirmar o expirar.

## Modelo de datos propuesto

### `companies`

Entidad CRUD administrable.

- `id`
- `name`
- `email`
- `phone`
- `address`
- `city`
- `timezone`
- `is_active`
- `created_at`
- `updated_at`

### `sports`

Catalogo global de deportes.

- `id`
- `name`
- `slug`
- `is_active`

### `company_sports`

Deportes habilitados por empresa.

- `company_id`
- `sport_id`

### `courts`

Representa tanto canchas fisicas como subcanchas derivadas.

- `id`
- `company_id`
- `parent_court_id` nullable
- `root_court_id`
- `name`
- `format` (`soccer_11`, `soccer_8`, `soccer_5`, etc.)
- `sport_id`
- `is_partitionable`
- `is_auto_generated`
- `layout_x`
- `layout_y`
- `layout_width`
- `layout_height`
- `is_active`

Reglas:

- Una cancha raiz tiene `parent_court_id = null`.
- Una subcancha apunta a su cancha padre.
- `root_court_id` permite agrupar rapidamente todo lo que comparte el mismo
  espacio fisico.
- Las coordenadas de layout son normalizadas de `0` a `1` para poder dibujar el
  mapa sin depender de pixeles.
- Las subcanchas autogeneradas pueden editar nombre/precio, pero no su geometria
  en una primera version.

### `court_partition_rules`

Define como se parte una cancha grande.

- `id`
- `source_format`
- `target_format`
- `child_count`
- `layout_json`
- `usable_area_ratio`
- `priority`
- `is_active`

`layout_json` guarda rectangulos normalizados:

```json
[
  { "x": 0, "y": 0, "width": 0.5, "height": 1 },
  { "x": 0.5, "y": 0, "width": 0.5, "height": 1 }
]
```

Reglas:

- Los rectangulos no pueden solaparse entre si.
- Los rectangulos deben quedar dentro de la cancha padre.
- El backend elige la regla activa con mejor combinacion de:
  `usable_area_ratio`, `priority` y menor espacio desperdiciado.
- Si no hay regla valida, la cancha se crea sin subcanchas y se registra un
  error de validacion claro.

### `court_prices`

Precio por hora.

- `id`
- `court_id`
- `sport_id`
- `price_per_hour`
- `currency`
- `valid_from`
- `valid_to`
- `is_active`

### `company_time_blocks`

Duraciones reservables por empresa.

- `id`
- `company_id`
- `duration_minutes`
- `is_active`

Reglas:

- Esta tabla no representa horarios de apertura, sino los tamanos de turno que
  la empresa permite vender.
- Ejemplo: si una empresa carga bloques de `60`, `90` y `120`, el cliente puede
  reservar turnos de 1 hora, 1 hora y media o 2 horas.
- El endpoint de disponibilidad usa estos bloques para generar slots posibles
  desde una hora de inicio y para validar que la duracion pedida sea vendible.
- `duration_minutes` debe ser positivo.
- Se recomienda validar multiplos de 15 minutos.
- Una reserva con una duracion que no existe para esa empresa se rechaza con
  `400`.

### `bookings`

Reserva o bloqueo temporal.

- `id`
- `company_id`
- `court_id`
- `sport_id`
- `starts_at`
- `ends_at`
- `status` (`held`, `confirmed`, `cancelled`, `expired`)
- `customer_name`
- `customer_email`
- `customer_phone`
- `price_total`
- `currency`
- `hold_expires_at`
- `created_by_user_id` nullable
- `created_at`
- `updated_at`

### `booking_locks`

Tabla tecnica para bloquear canchas afectadas por una reserva.

- `id`
- `booking_id`
- `court_id`
- `starts_at`
- `ends_at`

Regla clave:

- La reserva escribe locks sobre las canchas atomicas incompatibles.
- La DB impide overlaps sobre `court_id + rango horario`.
- Al cancelar o expirar una reserva se eliminan sus locks.
- Las canchas padre se marcan como no disponibles por derivacion cuando tienen
  locks activos en sus descendientes, pero una reserva chica no debe generar un
  lock exclusivo sobre todos sus ancestros porque eso impediria usar sus
  hermanas.

## Regla de bloqueo multicancha

Para una reserva sobre una cancha:

1. Siempre se bloquea la cancha atomica elegida, o las canchas atomicas
   contenidas por la cancha elegida.
2. Si la cancha elegida es una cancha grande, se bloquean todos sus
   descendientes reservables.
3. Si la cancha elegida es una subcancha, no se bloquean sus hermanas.
4. Los ancestros quedan no disponibles para reservas de formato grande mientras
   haya locks activos en sus descendientes, pero eso no bloquea a las hermanas
   chicas compatibles.

Ejemplos:

- Si se reserva la cancha de 11, quedan no disponibles sus canchas de 8 y 5.
- Si se reserva una cancha de 5 derivada, queda no disponible la cancha de 11,
  pero las canchas de 5 hermanas siguen disponibles en ese horario.
- Si se reserva una cancha de 8, queda no disponible la cancha de 11 y las
  subcanchas contenidas dentro de esa cancha de 8, pero no otras subcanchas
  independientes.

Implementacion sugerida:

- En una transaccion, calcular `affectedCourtIds` como canchas atomicas a
  bloquear.
- Insertar un row en `bookings`.
- Insertar rows en `booking_locks` para cada cancha afectada.
- Usar una exclusion constraint o validacion transaccional con lock para
  impedir overlaps.

## Regla anti-fragmentacion

Ademas de evitar overlaps, el sistema debe evitar desperdiciar espacio cuando
hay varias formas equivalentes de asignar una reserva chica.

Regla:

- Para reservas de un mismo formato chico dentro de una misma cancha raiz,
  mismo horario y mismo deporte, el backend debe llenar primero el grupo padre
  que ya esta parcialmente ocupado antes de abrir otro grupo padre.
- El grupo padre es el ancestro inmediato que quedaria inutilizable para un
  formato mas grande. Ejemplo: para canchas de 5 dentro de canchas de 8, el
  grupo padre es la cancha de 8.
- Si hay varios grupos parcialmente ocupados, se elige primero el que tenga mas
  canchas chicas ocupadas y todavia tenga hermanas disponibles.
- Solo cuando ese grupo padre ya no tiene canchas chicas libres, el sistema
  permite ocupar el siguiente grupo padre.

Ejemplo:

- Una cancha de 11 se parte en tres canchas de 8.
- Cada cancha de 8 se parte en tres canchas de 5.
- Si se reserva una cancha de 5 dentro de la primera cancha de 8, esa cancha de
  8 queda no disponible como cancha de 8.
- Si otro cliente pide una cancha de 5 en el mismo horario, el sistema debe
  ofrecer o aceptar primero las otras dos canchas de 5 dentro de esa misma
  cancha de 8.
- No se debe permitir ocupar una cancha de 5 dentro de otra cancha de 8 hasta
  que las tres canchas de 5 del primer grupo esten ocupadas o no disponibles.

Comportamiento esperado:

- El endpoint de disponibilidad debe marcar las canchas chicas que violarian
  compactacion como `compaction_blocked` o no ofrecerlas como seleccionables.
- Si el cliente llama al endpoint de hold con una cancha chica que viola esta
  regla, el backend debe responder `409 Conflict` con alternativas sugeridas.
- La regla se valida dentro de la misma transaccion que crea la reserva, para
  que dos usuarios compitiendo por el mismo horario no puedan abrir grupos
  distintos al mismo tiempo.

## Guardas anti-overlap

La proteccion principal debe vivir en la base de datos.

Opcion preferida en PostgreSQL:

- Crear extension `btree_gist` si esta disponible.
- Agregar exclusion constraint en `booking_locks`:
  `court_id WITH =` y rango `tstzrange(starts_at, ends_at, '[)') WITH &&`.

Si se evita la extension:

- Usar transaccion `SERIALIZABLE` o advisory lock por `root_court_id + dia`.
- Consultar overlaps con `FOR UPDATE`.
- Insertar solo si no hay conflictos.

En ambos casos, la API debe devolver `409 Conflict` cuando el slot ya no esta
disponible.

## Endpoints

### CRUD reutilizable

Agregar a la SSOT y usar `/api/:tableName` para:

- `companies`
- `sports`
- `company_sports`
- `courts`
- `court_partition_rules`
- `court_prices`
- `company_time_blocks`

Estos endpoints quedan protegidos por auth existente. Las escrituras requieren
usuario autorizado para esa empresa.

### Endpoints especificos

#### Crear cancha con particionado

`POST /api/companies/:companyId/courts`

Responsabilidad:

- Crear cancha raiz.
- Si `is_partitionable = true`, aplicar reglas de particionado.
- Crear subcanchas automaticamente en la misma transaccion.
- Rollback completo si falla cualquier insert o regla.

#### Disponibilidad para mapa

`GET /api/companies/:companyId/availability`

Query sugerida:

- `date`
- `sport_id`
- `duration_minutes`

Respuesta:

- Empresa.
- Canchas y subcanchas con layout.
- Slots disponibles por cancha.
- Precio estimado por slot.
- Estado visual: `available`, `held`, `confirmed`, `unavailable`,
  `compaction_blocked`.

#### Crear hold de reserva

`POST /api/bookings/hold`

Body:

- `company_id`
- `court_id`
- `sport_id`
- `starts_at`
- `duration_minutes`
- datos de cliente

Responsabilidad:

- Validar timeblock permitido.
- Validar deporte habilitado por empresa/cancha.
- Validar regla anti-fragmentacion.
- Calcular precio.
- Crear booking `held`.
- Crear locks.
- Hacer rollback ante cualquier error.
- Devolver `409` si hay overlap o si la cancha elegida viola compactacion.

#### Confirmar reserva

`POST /api/bookings/:id/confirm`

Responsabilidad:

- Confirmar solo si el hold no expiro.
- Mantener locks.
- Actualizar status a `confirmed`.
- Rollback ante error.

#### Cancelar reserva

`POST /api/bookings/:id/cancel`

Responsabilidad:

- Cambiar status.
- Borrar locks.
- Auditar accion.

## Frontend

### Administracion empresa

Extender la UI actual con tablas CRUD para:

- Empresas.
- Deportes habilitados.
- Canchas.
- Precios.
- Timeblocks.
- Reglas de particionado.

Mantener el patron actual de tabla + formulario dinamico cuando alcance.

### Mapa interactivo

Nuevo componente puntual, no generico, para disponibilidad:

- Selector de empresa.
- Selector de deporte.
- Selector de fecha.
- Selector de duracion/timeblock.
- Mapa con rectangulos normalizados.
- Colores por disponibilidad.
- Click en cancha + slot para crear hold.
- Confirmacion de reserva.

El mapa debe consumir el endpoint de disponibilidad en vez de duplicar reglas
de overlap en el frontend.

## Auth y multiempresa

Usar `auth.users` como identidad.

Agregar una tabla de permisos por empresa:

### `auth.user_companies`

- `user_id`
- `company_id`
- `role` (`owner`, `manager`, `staff`, `viewer`)

Reglas:

- `admin` global puede administrar todas las empresas.
- Usuarios asociados a una empresa solo pueden operar sobre su empresa.
- Clientes pueden reservar sin cuenta en fase inicial, dejando datos de
  contacto en `bookings`.

## Flujo de reserva transaccional

1. Cliente abre mapa de una empresa.
2. Frontend pide disponibilidad.
3. Cliente elige cancha y horario.
4. Frontend llama `POST /api/bookings/hold`.
5. Backend inicia transaccion.
6. Backend valida empresa, deporte, timeblock, precio y disponibilidad.
7. Backend valida compactacion para no abrir otro grupo padre
   innecesariamente.
8. Backend crea `booking`.
9. Backend crea `booking_locks`.
10. Si cualquier paso falla, rollback.
11. Si todo sale bien, commit y respuesta con hold.
12. Cliente confirma.
13. Backend confirma el booking si el hold sigue vigente.

## Limpieza de holds expirados

Primera version simple:

- Antes de calcular disponibilidad o crear un hold, expirar holds vencidos:
  update a `expired` y borrar locks asociados.

Version posterior:

- Job periodico dentro del backend o tarea externa.

## Criterios de aceptacion

- Crear una empresa y configurar deportes.
- Crear una cancha de 11 y ver subcanchas autogeneradas segun reglas activas.
- La geometria de subcanchas no se solapa y no sale del area padre.
- La disponibilidad muestra cancha grande y subcanchas con horarios.
- Reservar cancha grande bloquea todas sus subcanchas en ese horario.
- Reservar una subcancha bloquea la grande, pero no sus hermanas.
- En una cancha 11 -> 3 canchas de 8 -> 3 canchas de 5 por cada 8, si una
  cancha de 5 esta reservada, las proximas reservas de 5 del mismo horario
  deben llenar primero las hermanas dentro de esa misma cancha de 8.
- El sistema no permite abrir otra cancha de 8 para reservas de 5 mientras el
  primer grupo de 5 tenga disponibilidad.
- Dos reservas solapadas sobre la misma cancha devuelven `409`.
- Dos reservas compatibles sobre subcanchas hermanas se permiten.
- Timeblocks no habilitados se rechazan con `400`.
- Precio total se calcula segun precio por hora y duracion.
- Si falla cualquier insert durante una reserva, no quedan bookings ni locks
  parciales.

## Plan de implementacion

### Fase 1: Schema y CRUD base

- Agregar migracion con tablas nuevas.
- Agregar tablas CRUD a `shared/src/ssot/structure.ts`.
- Ajustar validaciones minimas.
- Tests de migracion y constraints principales.

### Fase 2: Particionado automatico

- Agregar servicio backend para crear cancha con subcanchas.
- Agregar reglas iniciales para `soccer_11 -> soccer_5` y
  `soccer_11 -> soccer_8`.
- Tests unitarios de layout: fit, no overlap, area util.

### Fase 3: Reservas y locks

- Agregar endpoints `hold`, `confirm`, `cancel`.
- Implementar transacciones y guardas anti-overlap.
- Implementar regla anti-fragmentacion para llenar grupos padre antes de abrir
  otro.
- Tests de escenarios padre/hijo/hermanas, compactacion y rollback.

### Fase 4: Disponibilidad y mapa

- Agregar endpoint de disponibilidad.
- Crear componente de mapa en frontend.
- Conectar selector de empresa, deporte, fecha y duracion.

### Fase 5: Permisos multiempresa

- Agregar `auth.user_companies`.
- Filtrar escrituras por empresa.
- Tests de acceso cruzado entre empresas.

## Fuera de alcance inicial

- Integracion con pasarela de pago.
- Cuentas de cliente final.
- Reglas avanzadas de precio por dia/hora pico.
- Edicion visual drag-and-drop de layouts.
- Calendarios recurrentes complejos.
