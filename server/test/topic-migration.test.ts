import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import m1 from '../migrations/0001_init.sql?raw';
import m2 from '../migrations/0002_region_display_name.sql?raw';
import m3 from '../migrations/0003_games.sql?raw';
import m5 from '../migrations/0005_leaderboard.sql?raw';
import m6 from '../migrations/0006_quiz_topics.sql?raw';
it('topic expansion preserves existing games, answers and scores with valid foreign keys',()=>{
 const db=new DatabaseSync(':memory:');db.exec(m1+m2+m3+m5);
 db.exec(`INSERT INTO games(id,topic,created_at,last_at) VALUES('old','age',1,2);
 INSERT INTO game_questions(game_id,question_id,number,stat_key,a_code,b_code,answer_code,values_json,ref_date,source,asked_at)
 VALUES('old','q1',1,'avg_age','11','26','11','[]','2026-09','test',1);
 INSERT INTO leaderboard(id,game_id,topic,nickname,streak,created_at) VALUES('score','done','cars','시험기록',3,1);`);
 const before=['games','game_questions','leaderboard'].map(t=>db.prepare('SELECT * FROM '+t).all());
 db.exec('BEGIN;'+m6+'COMMIT;');
 expect(['games','game_questions','leaderboard'].map(t=>db.prepare('SELECT * FROM '+t).all())).toEqual(before);
 expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 for(const topic of ['nature','industry']){
  db.prepare('INSERT INTO games(id,topic,created_at,last_at) VALUES(?,?,1,1)').run(topic,topic);
  db.prepare('INSERT INTO leaderboard(id,game_id,topic,nickname,streak,created_at) VALUES(?,?,?, ?,1,1)').run(topic,topic,topic,'새기록');
 }
 expect(()=>db.exec("INSERT INTO games(id,topic,created_at,last_at) VALUES('bad','invalid',1,1)")).toThrow();
 expect(()=>db.exec("INSERT INTO game_questions(game_id,question_id,number,stat_key,a_code,b_code,answer_code,values_json,ref_date,source,asked_at) VALUES('missing','x',1,'area','11','26','11','[]','2023','test',1)")).toThrow();
 db.close();
});
