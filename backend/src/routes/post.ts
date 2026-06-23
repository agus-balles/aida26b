import express from 'express';
import { Pool } from 'pg';

import { structure } from '../../../shared/src/ssot/structure';
import type { TableKey } from '../../../shared/src/types/types';

import {
  getEntityName,
  getNotDerivableFields,
  tryQuery,
  formatTableColumnsForQuery,
} from '../helpers';

import {
  sendSuccessOperationMessage,
  sendNotFoundMessage,
  sendErrorMessage,
} from '../status_messages';

import {
  validateFullObject,
  sendErrorsIfInvalid,
} from '../validation/validate';

export async function postHandler(
  req: express.Request,
  res: express.Response,
  pool: Pool
) {
  const tableNameParam = req.params.tableName;

  if (!isKnownTable(tableNameParam)) {
    return sendNotFoundMessage(res, tableNameParam);
  }

  const tableName = tableNameParam as TableKey;
  const entityName = getEntityName(tableName);

  const validated = validateFullObject(tableName, req.body);

  if (sendErrorsIfInvalid(res, validated)) {
    return;
  }

  const notDerivableFields = getNotDerivableFields(tableName);

  const valuesToInsert = notDerivableFields.map(
    (fieldName) => (validated.data as Record<string, unknown>)[fieldName]
  );

  const [fieldNamesTuple, parametersNumbersTuple] =
    formatTableColumnsForQuery(notDerivableFields);

  const query = `
    INSERT INTO ${tableName} ${fieldNamesTuple}
    VALUES ${parametersNumbersTuple}
    RETURNING *
  `;

  const queryResponse = await tryQuery(pool, query, valuesToInsert);

  if (!queryResponse.success) {
    if (queryResponse.code === '23505') {
      return res.status(409).json({
        success: false,
        data: undefined,
        message: tableName === 'company_sports'
          ? 'Ese deporte ya está asociado a la empresa.'
          : 'Ya existe un registro con esos datos.',
      });
    }

    if (queryResponse.code === '23503') {
      return res.status(409).json({
        success: false,
        data: undefined,
        message: 'El valor seleccionado ya no está disponible. Actualizá e intentá nuevamente.',
      });
    }

    return sendErrorMessage(res, queryResponse.message);
  }

  return sendSuccessOperationMessage(
    res,
    entityName,
    queryResponse.data.rows[0],
    'created',
    201
  );
}

function isKnownTable(tableName: string): tableName is TableKey {
  return Object.prototype.hasOwnProperty.call(structure.tables, tableName);
}
