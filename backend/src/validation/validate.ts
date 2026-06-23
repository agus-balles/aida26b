import type { Response } from 'express';

// Validation core is shared with the frontend; this module adds the Express-only response helper.
export * from '../../../shared/src/validation/validate';

export function sendErrorsIfInvalid<T>(
  res: Response,
  result: { data: T } | { errors: string[] },
): result is { errors: string[] } {
  if ('errors' in result) {
    res.status(400).json({ error: getValidationMessage(result.errors) });
    return true;
  }
  return false;
}

function getValidationMessage(errors: string[]): string {
  if (errors.some((error) => error.includes(' is required'))) {
    return 'Completá todos los campos requeridos.';
  }

  if (errors.some((error) => error.includes('must be one of'))) {
    return 'Uno de los valores seleccionados ya no está disponible.';
  }

  if (errors.some((error) => error.includes('must be a number'))) {
    return 'Ingresá valores numéricos válidos.';
  }

  return 'Revisá los datos ingresados e intentá nuevamente.';
}
