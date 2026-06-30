import { TableStructure } from '../types/types';

type LocalizedText = {
  es: string;
  en: string;
};

function getCurrentLanguage(): keyof LocalizedText {
  return globalThis.localStorage?.getItem('language') === 'en' ? 'en' : 'es';
}

function localizeText(text: LocalizedText): string {
  return text[getCurrentLanguage()] ?? text.es;
}

const courtFormatOptions: Array<{ value: string; label: LocalizedText }> = [
  { value: 'soccer_11', label: { es: 'Fútbol 11', en: 'Soccer 11' } },
  { value: 'soccer_9', label: { es: 'Fútbol 9', en: 'Soccer 9' } },
  { value: 'soccer_8', label: { es: 'Fútbol 8', en: 'Soccer 8' } },
  { value: 'soccer_7', label: { es: 'Fútbol 7', en: 'Soccer 7' } },
  { value: 'soccer_6', label: { es: 'Fútbol 6', en: 'Soccer 6' } },
  { value: 'soccer_5', label: { es: 'Fútbol 5', en: 'Soccer 5' } },
  { value: 'padel', label: { es: 'Pádel', en: 'Padel' } },
  { value: 'tennis', label: { es: 'Tenis', en: 'Tennis' } },
  { value: 'basketball', label: { es: 'Básquet', en: 'Basketball' } },
  { value: 'basketball_half', label: { es: 'Media cancha de básquet', en: 'Half basketball court' } },
  { value: 'volleyball', label: { es: 'Vóley', en: 'Volleyball' } },
  { value: 'volleyball_training', label: { es: 'Zona de entrenamiento de vóley', en: 'Volleyball training area' } },
];

const partitionLayoutOptions: Array<{ value: string; label: LocalizedText }> = [
  {
    value: '[{"x":0,"y":0,"width":1,"height":1}]',
    label: { es: 'Conversión de cancha completa', en: 'Full-court conversion' },
  },
  {
    value: '[{"x":0,"y":0,"width":0.5,"height":1},{"x":0.5,"y":0,"width":0.5,"height":1}]',
    label: { es: '2 canchas lado a lado', en: '2 side-by-side courts' },
  },
  {
    value: '[{"x":0,"y":0,"width":0.333333,"height":1},{"x":0.333333,"y":0,"width":0.333334,"height":1},{"x":0.666667,"y":0,"width":0.333333,"height":1}]',
    label: { es: '3 canchas lado a lado', en: '3 side-by-side courts' },
  },
  {
    value: '[{"x":0,"y":0,"width":0.5,"height":0.5},{"x":0.5,"y":0,"width":0.5,"height":0.5},{"x":0,"y":0.5,"width":0.5,"height":0.5},{"x":0.5,"y":0.5,"width":0.5,"height":0.5}]',
    label: { es: '4 canchas en grilla 2x2', en: '4 courts in a 2x2 grid' },
  },
  {
    value: '[{"x":0,"y":0,"width":0.333333,"height":0.5},{"x":0.333333,"y":0,"width":0.333334,"height":0.5},{"x":0.666667,"y":0,"width":0.333333,"height":0.5},{"x":0,"y":0.5,"width":0.333333,"height":0.5},{"x":0.333333,"y":0.5,"width":0.333334,"height":0.5},{"x":0.666667,"y":0.5,"width":0.333333,"height":0.5}]',
    label: { es: '6 canchas en grilla 3x2', en: '6 courts in a 3x2 grid' },
  },
];

export const structure = {
  tables: {
    companies: {
      columns: {
        id: {
          type: 'number',
          label: { es: 'ID', en: 'ID' },
          editable: false,
          visible: false,
        },

        name: {
          type: 'string',
          label: { es: 'Nombre', en: 'Name' },
          validator: {
            required: true,
          },
          searchable: true,
        },

        email: {
          type: 'string',
          label: { es: 'Email', en: 'Email' },
          input: 'email',
          validator: {
            nullable: true,
            pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
            patternMessage: 'must be a valid email address',
          },
        },

        phone: {
          type: 'string',
          label: { es: 'Teléfono', en: 'Phone' },
          validator: {
            nullable: true,
          },
        },

        address: {
          type: 'string',
          label: { es: 'Dirección', en: 'Address' },
          input: 'textarea',
          validator: {
            nullable: true,
          },
        },

        city: {
          type: 'string',
          label: { es: 'Ciudad', en: 'City' },
          validator: {
            nullable: true,
          },
          searchable: true,
        },

        timezone: {
          type: 'string',
          label: { es: 'Zona horaria', en: 'Timezone' },
          defaultValue: 'America/Argentina/Buenos_Aires',
          validator: {
            required: true,
          },
        },

        is_active: {
          type: 'boolean',
          label: { es: 'Activa', en: 'Active' },
          editable: false,
          searchable: true,
        },
      },
      pk: 'id',
      uiName: { es: 'Empresa', en: 'Company' },
      title: { es: 'Empresas', en: 'Companies' },
      addButtonLabel: { es: 'Agregar Empresa', en: 'Add Company' },
    } satisfies TableStructure,

    sports: {
      columns: {
        id: {
          type: 'number',
          label: { es: 'ID', en: 'ID' },
          editable: false,
          visible: false,
        },

        name: {
          type: 'string',
          label: { es: 'Nombre', en: 'Name' },
          validator: {
            required: true,
          },
          searchable: true,
        },

        slug: {
          type: 'string',
          label: { es: 'Clave', en: 'Slug' },
          validator: {
            required: true,
            pattern: '^[a-z0-9_]+$',
            patternMessage: 'must contain lowercase letters, numbers or underscores',
          },
          searchable: true,
        },

        is_active: {
          type: 'boolean',
          label: { es: 'Activo', en: 'Active' },
          editable: false,
          searchable: true,
        },
      },
      pk: 'id',
      uiName: { es: 'Deporte', en: 'Sport' },
      title: { es: 'Deportes', en: 'Sports' },
      addButtonLabel: { es: 'Agregar Deporte', en: 'Add Sport' },
    } satisfies TableStructure,

    company_sports: {
      columns: {
        company_id: {
          type: 'number',
          label: { es: 'Empresa', en: 'Company' },
          readonlyOnEdit: true,
          validator: {
            required: true,
            integer: true,
            minValue: 1,
          },
          input: 'select',
          foreignKey: {
            table: 'companies',
            valueField: 'id',
            labelField: 'name',
          },
        },

        sport_id: {
          type: 'number',
          label: { es: 'Deporte', en: 'Sport' },
          readonlyOnEdit: true,
          validator: {
            required: true,
            integer: true,
            minValue: 1,
          },
          input: 'select',
          foreignKey: {
            table: 'sports',
            valueField: 'id',
            labelField: 'name',
          },
        },
      },
      pk: ['company_id', 'sport_id'],
      uiName: { es: 'Deporte de Empresa', en: 'Company Sport' },
      title: { es: 'Deportes por Empresa', en: 'Company Sports' },
      addButtonLabel: { es: 'Agregar Deporte a Empresa', en: 'Add Company Sport' },
      showInNavigation: false,
    } satisfies TableStructure,

    courts: {
      columns: {
        id: {
          type: 'number',
          label: { es: 'ID', en: 'ID' },
          editable: false,
          visible: false,
        },

        company_id: {
          type: 'number',
          label: { es: 'Empresa', en: 'Company' },
          validator: {
            required: true,
            integer: true,
            minValue: 1,
          },
          input: 'select',
          foreignKey: {
            table: 'companies',
            valueField: 'id',
            labelField: 'name',
          },
          searchable: true,
        },

        parent_court_id: {
          type: 'number',
          label: { es: 'Cancha Padre', en: 'Parent Court' },
          editable: false,
          visible: false,
        },

        root_court_id: {
          type: 'number',
          label: { es: 'Cancha Raíz', en: 'Root Court' },
          editable: false,
          visible: false,
        },

        name: {
          type: 'string',
          label: { es: 'Nombre', en: 'Name' },
          validator: {
            required: true,
          },
          searchable: true,
        },

        sport_id: {
          type: 'number',
          label: { es: 'Deporte', en: 'Sport' },
          validator: {
            required: true,
            integer: true,
            minValue: 1,
          },
          input: 'select',
          foreignKey: {
            table: 'sports',
            valueField: 'id',
            labelField: 'name',
          },
          searchable: true,
        },

        format: {
          type: 'string',
          label: { es: 'Formato', en: 'Format' },
          input: 'select',
          validator: {
            required: true,
          },
          options: courtFormatOptions,
          searchable: true,
        },

        is_partitionable: {
          type: 'string',
          label: { es: 'Particionable', en: 'Partitionable' },
          input: 'select',
          defaultValue: 'false',
          validator: {
            required: true,
          },
          options: [
            { value: 'true', label: { es: 'Sí', en: 'Yes' } },
            { value: 'false', label: { es: 'No', en: 'No' } },
          ],
          searchable: true,
        },

        is_auto_generated: {
          type: 'boolean',
          label: { es: 'Autogenerada', en: 'Auto-generated' },
          editable: false,
          visible: false,
        },

        layout_x: {
          type: 'number',
          label: { es: 'X', en: 'X' },
          editable: false,
          visible: false,
        },

        layout_y: {
          type: 'number',
          label: { es: 'Y', en: 'Y' },
          editable: false,
          visible: false,
        },

        layout_width: {
          type: 'number',
          label: { es: 'Ancho', en: 'Width' },
          editable: false,
          visible: false,
        },

        layout_height: {
          type: 'number',
          label: { es: 'Alto', en: 'Height' },
          editable: false,
          visible: false,
        },

        is_active: {
          type: 'boolean',
          label: { es: 'Activa', en: 'Active' },
          editable: false,
          searchable: true,
        },
      },
      pk: 'id',
      uiName: { es: 'Cancha', en: 'Court' },
      title: { es: 'Canchas', en: 'Courts' },
      addButtonLabel: { es: 'Agregar Cancha', en: 'Add Court' },
    } satisfies TableStructure,

    court_partition_rules: {
      columns: {
        id: {
          type: 'number',
          label: { es: 'ID', en: 'ID' },
          editable: false,
          visible: false,
        },

        source_format: {
          type: 'string',
          label: { es: 'Formato Origen', en: 'Source Format' },
          input: 'select',
          options: courtFormatOptions,
          validator: {
            required: true,
          },
        },

        target_format: {
          type: 'string',
          label: { es: 'Formato Destino', en: 'Target Format' },
          input: 'select',
          options: courtFormatOptions,
          validator: {
            required: true,
          },
        },

        target_sport_id: {
          type: 'number',
          label: { es: 'Deporte Destino', en: 'Target Sport' },
          input: 'select',
          foreignKey: {
            table: 'sports',
            valueField: 'id',
            labelField: 'name',
          },
          validator: {
            nullable: true,
          },
        },

        layout_json: {
          type: 'string',
          label: { es: 'Distribución', en: 'Layout' },
          input: 'select',
          options: partitionLayoutOptions,
          validator: {
            required: true,
          },
        },

        child_count: {
          type: 'number',
          label: { es: 'Subcanchas', en: 'Child Count' },
          input: 'number',
          validator: {
            required: true,
            integer: true,
            minValue: 1,
          },
        },

        usable_area_ratio: {
          type: 'number',
          label: { es: 'Área útil', en: 'Usable Area' },
          editable: false,
          visible: false,
        },

        priority: {
          type: 'string',
          label: { es: 'Prioridad', en: 'Priority' },
          input: 'select',
          defaultValue: '2',
          options: [
            { value: '1', label: { es: 'Baja', en: 'Low' } },
            { value: '2', label: { es: 'Media', en: 'Medium' } },
            { value: '3', label: { es: 'Alta', en: 'High' } },
          ],
          validator: {
            required: true,
          },
        },

        is_active: {
          type: 'boolean',
          label: { es: 'Activa', en: 'Active' },
          editable: false,
        },
      },
      pk: 'id',
      uiName: { es: 'Regla de Partición', en: 'Partition Rule' },
      title: { es: 'Reglas de Partición', en: 'Partition Rules' },
      addButtonLabel: { es: 'Agregar Regla', en: 'Add Rule' },
    } satisfies TableStructure,

    court_prices: {
      columns: {
        id: {
          type: 'number',
          label: { es: 'ID', en: 'ID' },
          editable: false,
          visible: false,
        },

        court_id: {
          type: 'number',
          label: { es: 'Cancha', en: 'Court' },
          validator: {
            required: true,
            integer: true,
            minValue: 1,
          },
          input: 'select',
          foreignKey: {
            table: 'courts',
            valueField: 'id',
            labelField: 'name',
          },
        },

        sport_id: {
          type: 'number',
          label: { es: 'Deporte', en: 'Sport' },
          validator: {
            required: true,
            integer: true,
            minValue: 1,
          },
          input: 'select',
          foreignKey: {
            table: 'sports',
            valueField: 'id',
            labelField: 'name',
          },
        },

        price_per_hour: {
          type: 'number',
          label: { es: 'Precio por Hora', en: 'Price per Hour' },
          input: 'number',
          validator: {
            required: true,
            minValue: 0,
          },
        },

        currency: {
          type: 'string',
          label: { es: 'Moneda', en: 'Currency' },
          defaultValue: 'ARS',
          validator: {
            required: true,
            pattern: '^[A-Z]{3}$',
            patternMessage: 'must be a 3-letter currency code',
          },
        },

        valid_from: {
          type: 'string',
          label: { es: 'Válido Desde', en: 'Valid From' },
          input: 'date',
          validator: {
            nullable: true,
          },
        },

        valid_to: {
          type: 'string',
          label: { es: 'Válido Hasta', en: 'Valid To' },
          input: 'date',
          validator: {
            nullable: true,
          },
        },

        is_active: {
          type: 'boolean',
          label: { es: 'Activo', en: 'Active' },
          editable: false,
        },
      },
      pk: 'id',
      uiName: { es: 'Precio de Cancha', en: 'Court Price' },
      title: { es: 'Precios', en: 'Prices' },
      addButtonLabel: { es: 'Agregar Precio', en: 'Add Price' },
    } satisfies TableStructure,

    company_time_blocks: {
      columns: {
        id: {
          type: 'number',
          label: { es: 'ID', en: 'ID' },
          editable: false,
          visible: false,
        },

        company_id: {
          type: 'number',
          label: { es: 'Empresa', en: 'Company' },
          validator: {
            required: true,
            integer: true,
            minValue: 1,
          },
          input: 'select',
          foreignKey: {
            table: 'companies',
            valueField: 'id',
            labelField: 'name',
          },
        },

        duration_minutes: {
          type: 'number',
          label: { es: 'Duración (min)', en: 'Duration (min)' },
          input: 'number',
          defaultValue: 60,
          validator: {
            required: true,
            integer: true,
            minValue: 15,
          },
        },

        is_active: {
          type: 'boolean',
          label: { es: 'Activo', en: 'Active' },
          editable: false,
        },
      },
      pk: 'id',
      uiName: { es: 'Bloque Horario', en: 'Time Block' },
      title: { es: 'Bloques Horarios', en: 'Time Blocks' },
      addButtonLabel: { es: 'Agregar Bloque', en: 'Add Time Block' },
    } satisfies TableStructure,
  },

  courtFormatsBySport: {
    soccer: ['soccer_11', 'soccer_9', 'soccer_8', 'soccer_7', 'soccer_6', 'soccer_5'],
    padel: ['padel'],
    tennis: ['tennis'],
    basketball: ['basketball'],
    volleyball: ['volleyball'],
  } satisfies Record<string, string[]>,

  menu: {
    theme: {
      title: { es: 'Tema', en: 'Theme' },
      id: 'theme-picker',
      handler: (value: string) => {
        try {
          if (!value) throw new Error('Theme value is required');

          document.documentElement.setAttribute('data-theme', value);
          localStorage.setItem('theme', value);
        } catch (err) {
          console.error('Error changing theme:', err);
          alert(localizeText(structure.commonText.themeChangeError));
        }
      },
      options: [
        { value: 'light', label: { es: 'Claro', en: 'Light' } },
        { value: 'dark', label: { es: 'Oscuro', en: 'Dark' } },
      ],
      initial: () => localStorage.getItem('theme') || 'light',
    },

    language: {
      title: { es: 'Idioma', en: 'Language' },
      id: 'language-picker',
      handler: (value: string) => {
        try {
          if (value !== 'es' && value !== 'en') {
            throw new Error('Invalid language value');
          }

          localStorage.setItem('language', value);

          window.dispatchEvent(
            new CustomEvent('languagechange', {
              detail: { language: value },
            })
          );
        } catch (err) {
          console.error('Error changing language:', err);
          alert(localizeText(structure.commonText.languageChangeError));
        }
      },
      options: [
        { value: 'es', label: { es: 'Español', en: 'Spanish' } },
        { value: 'en', label: { es: 'Inglés', en: 'English' } },
      ],
      initial: () => localStorage.getItem('language') || 'es',
    },
  },

  commonText: {
    actions: { es: 'Acciones', en: 'Actions' },
    add: { es: 'Agregar', en: 'Add' },
    appTitle: {
      es: 'Sistema de Reservas de Canchas',
      en: 'Court Booking System',
    },
    cancel: { es: 'Cancelar', en: 'Cancel' },
    delete: { es: 'Eliminar', en: 'Delete' },
    edit: { es: 'Editar', en: 'Edit' },
    home: { es: 'Inicio', en: 'Home' },
    update: { es: 'Actualizar', en: 'Update' },
    login: { es: 'Ingresar', en: 'Login' },
    signIn: { es: 'Inicia Sesión', en: 'Sign In' },
    password: { es: 'Contraseña', en: 'Password' },
    changePassword: { es: 'Cambiar contraseña', en: 'Change Password' },
    currentPassword: { es: 'Contraseña actual', en: 'Current Password' },
    newPassword: { es: 'Nueva contraseña', en: 'New Password' },
    logout: { es: 'Salir', en: 'Logout' },
    yes: { es: 'Sí', en: 'Yes' },
    no: { es: 'No', en: 'No' },
    added: { es: 'agregado', en: 'added' },
    notApplicable: { es: 'No aplica', en: 'Not applicable' },
    availability: { es: 'Reservas', en: 'Bookings' },
    company: { es: 'Empresa', en: 'Company' },
    sport: { es: 'Deporte', en: 'Sport' },
    date: { es: 'Fecha', en: 'Date' },
    duration: { es: 'Duración', en: 'Duration' },
    customerName: { es: 'Nombre del cliente', en: 'Customer Name' },
    customerEmail: { es: 'Email del cliente', en: 'Customer Email' },
    customerPhone: { es: 'Teléfono del cliente', en: 'Customer Phone' },
    reserve: { es: 'Reservar', en: 'Book' },
    confirm: { es: 'Confirmar', en: 'Confirm' },
    bookingHeld: { es: 'Reserva bloqueada', en: 'Booking held' },
    bookingConfirmed: { es: 'Reserva confirmada', en: 'Booking confirmed' },
    publicBooking: { es: 'Reservar cancha', en: 'Book a court' },
    childCourts: { es: 'subcanchas', en: 'child courts' },
    holdPendingOperator: {
      es: 'Tu solicitud quedó retenida. La empresa debe confirmarla antes de que venza.',
      en: 'Your request is on hold. The company must confirm it before it expires.',
    },

    // Operator bookings panel
    companyBookings: { es: 'Reservas de la empresa', en: 'Company bookings' },
    refreshBookings: { es: 'Actualizar', en: 'Refresh' },
    noBookings: { es: 'No hay reservas para esta empresa.', en: 'No bookings for this company.' },
    schedule: { es: 'Horario', en: 'Time' },
    customer: { es: 'Cliente', en: 'Customer' },
    status: { es: 'Estado', en: 'Status' },
    price: { es: 'Precio', en: 'Price' },
    bookingStatusHeld: { es: 'Retenida', en: 'Held' },
    bookingStatusConfirmed: { es: 'Confirmada', en: 'Confirmed' },
    bookingStatusCancelled: { es: 'Cancelada', en: 'Cancelled' },
    bookingStatusExpired: { es: 'Expirada', en: 'Expired' },
    bookingsTitle: { es: 'Reservas', en: 'Bookings' },
    courtSize: { es: 'Tamaño', en: 'Size' },
    allCompanies: { es: 'Todas las empresas', en: 'All companies' },
    statusActive: { es: 'Activas', en: 'Active' },
    statusAll: { es: 'Todas', en: 'All' },
    companyPermissions: { es: 'Permisos', en: 'Permissions' },
    createUser: { es: 'Crear usuario', en: 'Create user' },
    userRole: { es: 'Rol', en: 'Role' },
    userAccount: { es: 'Usuario', en: 'User' },
    companyAccount: { es: 'Empresa', en: 'Company' },
    userCreated: { es: 'Usuario creado', en: 'User created' },
    user: { es: 'Usuario', en: 'User' },
    companyRole: { es: 'Rol en empresa', en: 'Company role' },
    savePermission: { es: 'Guardar permiso', en: 'Save permission' },
    removePermission: { es: 'Quitar permiso', en: 'Remove permission' },
    permissionSaved: { es: 'Permiso guardado', en: 'Permission saved' },
    permissionRemoved: { es: 'Permiso eliminado', en: 'Permission removed' },
    owner: { es: 'Propietario', en: 'Owner' },
    manager: { es: 'Responsable', en: 'Manager' },
    staff: { es: 'Operador', en: 'Staff' },
    viewer: { es: 'Consulta', en: 'Viewer' },
    selectSportFirst: { es: 'Seleccioná un deporte primero', en: 'Select a sport first' },
    selectCompanyFirst: { es: 'Seleccioná una empresa primero', en: 'Select a company first' },
    selectCourtFirst: { es: 'Seleccioná una cancha primero', en: 'Select a court first' },
    selectFormatFirst: { es: 'Seleccioná un formato primero', en: 'Select a format first' },
    partitionRule: { es: 'Regla de partición', en: 'Partition rule' },
    applyPartitionRule: { es: 'Aplicar regla de partición', en: 'Apply partition rule' },
    choosePartitionRule: { es: 'Elegí una regla de partición', en: 'Choose a partition rule' },
    choosePartitionRuleToContinue: {
      es: 'Elegí una regla de partición para continuar.',
      en: 'Choose a partition rule to continue.',
    },
    loadingPartitionRules: { es: 'Cargando reglas...', en: 'Loading rules...' },
    noActivePartitionRules: {
      es: 'No hay reglas activas para este formato',
      en: 'No active rules for this format',
    },
    noPartitionRuleAvailable: {
      es: 'No hay una regla de partición disponible para este formato.',
      en: 'No partition rule is available for this format.',
    },
    partitionRulesLoadFailed: {
      es: 'No se pudieron cargar las reglas de partición.',
      en: 'Could not load partition rules.',
    },
    partitionRulesLoadFailedShort: {
      es: 'No se pudieron cargar las reglas',
      en: 'Could not load rules',
    },
    partitionRuleApplied: { es: 'Regla de partición aplicada.', en: 'Partition rule applied.' },
    partitionPreview: { es: 'Vista previa de la distribución', en: 'Layout preview' },
    partitionEditReadyHint: {
      es: 'Guardar ediciones no crea subcanchas. Aplicá una regla de forma explícita cuando estés listo.',
      en: 'Saving edits does not create child courts. Apply a rule explicitly when ready.',
    },
    partitionEditDisabledHint: {
      es: 'Guardar esta edición solo actualiza la cancha. Marcala como particionable y volvé a abrirla para aplicar una regla.',
      en: 'Saving this edit only updates the court. Mark it partitionable and reopen it to apply a rule.',
    },
    addCompanySportFirst: {
      es: 'Primero agregá un deporte a la empresa',
      en: 'Add a sport to the company first',
    },
    loadingCourtSport: {
      es: 'Cargando deporte de la cancha...',
      en: 'Loading court sport...',
    },
    courtNoSport: {
      es: 'La cancha no tiene un deporte asignado',
      en: 'The court has no assigned sport',
    },
    courtSportUnavailable: {
      es: 'El deporte de la cancha no está disponible',
      en: 'The court sport is unavailable',
    },
    layoutUnavailable: { es: 'Distribución no disponible', en: 'Layout unavailable' },

    // Auth / session messages
    sessionExpired: { es: 'La sesión expiró', en: 'Session expired' },
    passwordChangeRequired: { es: 'Hay que cambiar la contraseña', en: 'Password change required' },
    noPermission: { es: 'No tenés permiso para esa acción', en: 'You do not have permission for that action' },
    invalidCredentials: { es: 'Credenciales inválidas', en: 'Invalid credentials' },
    loginError: { es: 'Error ingresando', en: 'Login error' },
    passwordChangeFailed: { es: 'No se pudo cambiar la contraseña', en: 'Password change failed' },
    passwordChangeError: { es: 'Error cambiando contraseña', en: 'Password change error' },
    themeChangeError: { es: 'Error al cambiar el tema', en: 'Error changing theme' },
    languageChangeError: { es: 'Error al cambiar el idioma', en: 'Error changing language' },

    // Data / record messages
    errorLoadingData: { es: 'Error cargando datos', en: 'Error loading data' },
    errorSaving: { es: 'Error guardando', en: 'Error saving' },
    errorDeleting: { es: 'Error eliminando', en: 'Error deleting' },
    errorLoadingRecord: { es: 'Error cargando registro', en: 'Error loading record' },

    noEditPermission: { es: 'No tenés permiso para editar', en: 'You do not have edit permission' },
    usernameLabel: { es: 'Usuario', en: 'Username' },
    emailLabel: { es: 'Email', en: 'Email' },

    // Filters / pagination
    addFilter: { es: 'Agregar Filtro', en: 'Add Filter' },
    selectColumn: { es: 'Seleccionar columna', en: 'Select column' },
    pageInfo: { es: 'Página', en: 'Page' },
    pageOf: { es: 'de', en: 'of' },
    total: { es: 'Total', en: 'Total' },
    previous: { es: 'Anterior', en: 'Previous' },
    next: { es: 'Siguiente', en: 'Next' },
    filterPlaceholder: { es: 'Filtrar...', en: 'Filter...' },

    // Delete confirmation
    deleteConfirm: {
      es: '¿Está seguro de que desea eliminar este',
      en: 'Are you sure you want to delete this',
    },

    // Courts table / tree
    court: { es: 'Cancha', en: 'Court' },
    format: { es: 'Formato', en: 'Format' },
    state: { es: 'Estado', en: 'Status' },
    subcourts: { es: 'Subcanchas', en: 'Child courts' },
    mainCourt: { es: 'Cancha principal', en: 'Main court' },
    childCourtOf: { es: 'Subcancha de', en: 'Child court of' },
    partitionable: { es: 'Particionable', en: 'Partitionable' },
    notPartitionable: { es: 'No particionable', en: 'Not partitionable' },
    active: { es: 'Activa', en: 'Active' },
    inactive: { es: 'Inactiva', en: 'Inactive' },
    noChildCourts: { es: 'Sin subcanchas', en: 'No child courts' },
    childCourt: { es: 'subcancha', en: 'child court' },
    showChildCourtsOf: { es: 'Mostrar subcanchas de', en: 'Show child courts of' },

    // Search / sort
    search: { es: 'Buscar', en: 'Search' },
    searchCompany: { es: 'Buscar empresa', en: 'Search company' },
    clickToSort: { es: 'Clic para ordenar', en: 'Click to sort' },
    searchHintCourts: {
      es: 'Buscar por cancha, empresa, deporte, formato o estado',
      en: 'Search by court, company, sport, format or status',
    },
    searchHintCompanies: {
      es: 'Buscar por empresa, ciudad o estado',
      en: 'Search by company, city or status',
    },
    searchHintPartitionRules: {
      es: 'Buscar reglas por formato',
      en: 'Search rules by format',
    },
    searchHintPrices: {
      es: 'Buscar por cancha o deporte',
      en: 'Search by court or sport',
    },
    searchHintTimeBlocks: {
      es: 'Buscar por empresa',
      en: 'Search by company',
    },

    // Availability suggestions
    suggestedCourts: { es: 'Sugerencias', en: 'Suggestions' },

    // Company sports
    enabledSports: { es: 'Deportes habilitados', en: 'Enabled sports' },

    // Dialog
    error: { es: 'Error', en: 'Error' },
    accept: { es: 'Aceptar', en: 'Accept' },

    // Role labels
    roleReader: { es: 'Lector', en: 'Reader' },
    roleEditor: { es: 'Editor', en: 'Editor' },
  } satisfies Record<string, LocalizedText>,
};
