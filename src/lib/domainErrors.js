export class DomainError extends Error { constructor(message, code = 'DOMAIN_ERROR') { super(message); this.name = code; this.code = code; } }
export class ValidationError extends DomainError { constructor(message) { super(message, 'VALIDATION_ERROR'); } }
export class NotFoundError extends DomainError { constructor(message = 'Registro não encontrado.') { super(message, 'NOT_FOUND'); } }
export class StockError extends DomainError { constructor(message) { super(message, 'STOCK_ERROR'); } }
export class PermissionError extends DomainError { constructor(message = 'Você não tem permissão para esta ação.') { super(message, 'PERMISSION_ERROR'); } }
export class ConflictError extends DomainError { constructor(message) { super(message, 'CONFLICT_ERROR'); } }
export const friendlyError = (error) => error?.code ? error.message : 'Não foi possível concluir a operação. Tente novamente.';
