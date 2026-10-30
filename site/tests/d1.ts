/** Minimal D1-compatible adapter over disposable node:sqlite, including real atomic batch semantics. */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
/** Create schema-only in-memory D1 with prepared statements and transactional batch support. */
export function testDatabase():D1Database {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../drizzle/0000_luxuriant_mordo.sql',import.meta.url),'utf8'));
  /** Wrap one prepared statement without evaluating it until run/first/all/batch. */
  function prepare(sql:string):D1PreparedStatement {
    let values:(string|number|null)[]=[];
    const statement={sql,get values(){return values;},bind(...args:(string|number|null)[]){values=args;return statement;},
      async run(){const r=sqlite.prepare(sql).run(...values);return {success:true,results:[],meta:{changes:Number(r.changes)}};},
      async first(){return sqlite.prepare(sql).get(...values)??null;},
      async all(){return {success:true,results:sqlite.prepare(sql).all(...values),meta:{changes:0}};},
    };return statement as unknown as D1PreparedStatement;
  }
  return {prepare,async batch(statements:D1PreparedStatement[]){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}} as D1Database;
}
