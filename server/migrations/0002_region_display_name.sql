-- 문제에 보여 줄 이름(같은 이름 구분용: "서울 중구"). 기존 줄은 NULL이면 name을 쓴다.
ALTER TABLE regions ADD COLUMN display_name TEXT;
