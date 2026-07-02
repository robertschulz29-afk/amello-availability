/**
 * Lightweight SQL WHERE-clause builder for parameterized queries.
 *
 * Usage:
 *   const qb = new QueryBuilder();
 *   qb.add('sr.scan_id = ?', scanID);
 *   qb.addIn('sr.hotel_id', hotelIDs);
 *   const { where, params } = qb.build();
 *   await query(`SELECT … FROM … ${where}`, params);
 */
export class QueryBuilder {
  private conditions: string[] = [];
  private _params: unknown[] = [];

  get paramCount() {
    return this._params.length;
  }

  /** Add a single `col = $n` condition. Skips if value is null/undefined. */
  add(condition: string, value: unknown): this {
    if (value === null || value === undefined) return this;
    this._params.push(value);
    // Replace the `?` placeholder with the real positional $n
    this.conditions.push(condition.replace('?', `$${this._params.length}`));
    return this;
  }

  /**
   * Add a literal condition with no placeholder (e.g. `h.active = true`).
   * Use only for fixed boolean expressions — never for user-supplied values.
   */
  addLiteral(condition: string): this {
    this.conditions.push(condition);
    return this;
  }

  /** Add a `col = $n` or `col IN ($n, …)` condition for an array of IDs. */
  addIn(column: string, ids: number[]): this {
    if (ids.length === 0) return this;
    if (ids.length === 1) {
      return this.add(`${column} = ?`, ids[0]);
    }
    const placeholders = ids.map(id => {
      this._params.push(id);
      return `$${this._params.length}`;
    }).join(', ');
    this.conditions.push(`${column} IN (${placeholders})`);
    return this;
  }

  /** Returns the WHERE clause (or '') and the params array. */
  build(): { where: string; params: unknown[] } {
    return {
      where: this.conditions.length ? `WHERE ${this.conditions.join(' AND ')}` : '',
      params: this._params,
    };
  }

  /**
   * Returns the WHERE clause prefixed with AND (for appending to an
   * existing WHERE block), or '' if there are no conditions.
   */
  buildAnd(): { where: string; params: unknown[] } {
    return {
      where: this.conditions.length ? `AND ${this.conditions.join(' AND ')}` : '',
      params: this._params,
    };
  }
}
