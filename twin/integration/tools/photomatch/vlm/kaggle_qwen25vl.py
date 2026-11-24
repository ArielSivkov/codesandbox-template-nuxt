#!/usr/bin/env python3
"""kaggle_qwen25vl.py – שיפוט ויזואלי של זוגות צילום/רינדור עם Qwen2.5-VL, למחברת Kaggle (GPU). לא הורץ בסביבת הבנייה.

python kaggle_qwen25vl.py --tasks /kaggle/input/photomatch-pairs/tasks-360x800.jsonl --root /kaggle/input/photomatch-pairs \
                          --out /kaggle/working/results.jsonl [--model Qwen/Qwen2.5-VL-7B-Instruct] [--max-pixels 401408] [--limit 0]
קלט: שורת JSON לכל משימה {id, photo, render, prompt} (נוצר ע"י vlm/hook.py). פלט: {id, model, result, raw, secs, error?}
תוצאה תקינה = אותה סכמה כמו DummyJudge (vlm/hook.py validate). JSON שבור → ניסיון תיקון אחד, אחרת error.
T4 לא תומך ב-bf16 → float16. 7B על 2×T4 עם device_map=auto; 3B נכנס ל-T4 יחיד ומהיר בערך פי 2.
"""
import argparse, json, os, re, sys, time

def extract_json(txt):
    t = txt.strip()
    t = re.sub(r'^```(?:json)?\s*|\s*```$', '', t)
    i, j = t.find('{'), t.rfind('}')
    if i < 0 or j <= i: raise ValueError('no JSON object')
    return json.loads(t[i:j + 1])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tasks', required=True); ap.add_argument('--root', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--model', default='Qwen/Qwen2.5-VL-7B-Instruct'); ap.add_argument('--max-pixels', type=int, default=448 * 896); ap.add_argument('--min-pixels', type=int, default=256 * 28 * 28)
    ap.add_argument('--max-new-tokens', type=int, default=900); ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    import torch
    from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor
    from qwen_vl_utils import process_vision_info
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(a.model, torch_dtype=torch.float16, device_map='auto')
    proc = AutoProcessor.from_pretrained(a.model, min_pixels=a.min_pixels, max_pixels=a.max_pixels)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from hook import validate
    except Exception:
        validate = lambda d: []
    done = set()
    if os.path.exists(a.out):
        for ln in open(a.out, encoding='utf-8'):
            try: done.add(json.loads(ln)['id'])
            except Exception: pass
    fo = open(a.out, 'a', encoding='utf-8'); n = 0
    for ln in open(a.tasks, encoding='utf-8'):
        if not ln.strip(): continue
        t = json.loads(ln)
        if t['id'] in done: continue
        if a.limit and n >= a.limit: break
        t0 = time.time(); rec = {'id': t['id'], 'model': a.model}
        msgs = [{'role': 'user', 'content': [
            {'type': 'image', 'image': 'file://' + os.path.join(a.root, t['photo'])},
            {'type': 'image', 'image': 'file://' + os.path.join(a.root, t['render'])},
            {'type': 'text', 'text': t['prompt']}]}]
        try:
            text = proc.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
            imgs, vids = process_vision_info(msgs)
            inp = proc(text=[text], images=imgs, videos=vids, padding=True, return_tensors='pt').to(model.device)
            with torch.no_grad():
                gen = model.generate(**inp, max_new_tokens=a.max_new_tokens, do_sample=False)
            raw = proc.batch_decode(gen[:, inp.input_ids.shape[1]:], skip_special_tokens=True)[0]; rec['raw'] = raw
            try:
                res = extract_json(raw)
            except Exception:
                fix = [{'role': 'user', 'content': [{'type': 'text', 'text': 'Fix this into valid JSON only, same content:\n' + raw[:4000]}]}]
                ft = proc.apply_chat_template(fix, tokenize=False, add_generation_prompt=True); fi = proc(text=[ft], return_tensors='pt').to(model.device)
                with torch.no_grad():
                    g2 = model.generate(**fi, max_new_tokens=a.max_new_tokens, do_sample=False)
                res = extract_json(proc.batch_decode(g2[:, fi.input_ids.shape[1]:], skip_special_tokens=True)[0])
            res['id'] = t['id']; res['model'] = a.model; rec['result'] = res; rec['schema_errors'] = validate(res)
        except Exception as e:
            rec['error'] = repr(e)[:500]
        rec['secs'] = round(time.time() - t0, 1); fo.write(json.dumps(rec, ensure_ascii=False) + '\n'); fo.flush(); n += 1
        print(t['id'], rec.get('secs'), 'ok' if 'result' in rec else rec.get('error'), flush=True)
    fo.close()

if __name__ == '__main__':
    main()
