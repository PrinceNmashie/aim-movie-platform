"""Per-project request evidence. Returned usage is evidence, never a claimed invoice."""
import csv
import io
import json
import uuid
from flask import abort, send_file
import store

def init(c):
    c.execute('CREATE TABLE IF NOT EXISTS usage_ledger(id TEXT PRIMARY KEY,feature TEXT,provider TEXT,model TEXT,request_id TEXT,started TEXT,finished TEXT,status TEXT,usage TEXT)')

def call(feature,model,fn,provider='openai'):
    event=uuid.uuid4().hex;started=store.now()
    with store.connect() as c:
        init(c);c.execute('INSERT INTO usage_ledger VALUES(?,?,?,?,?,?,?,?,?)',(event,feature,provider,model,'',started,'','started','{}'))
    try:response=fn()
    except Exception as exc:
        with store.connect() as c:
            c.execute('UPDATE usage_ledger SET request_id=?,finished=?,status=? WHERE id=?',(str(getattr(exc,'request_id','') or ''),store.now(),'error_or_unconfirmed',event))
        raise
    usage=getattr(response,'usage',None) if not isinstance(response,dict) else response.get('usage')
    if hasattr(usage,'model_dump'):usage=usage.model_dump()
    if not isinstance(usage,dict):usage={}
    request_id=(getattr(response,'_request_id',None) or getattr(response,'id',None)) if not isinstance(response,dict) else response.get('id')
    with store.connect() as c:
        c.execute('UPDATE usage_ledger SET request_id=?,finished=?,status=?,usage=? WHERE id=?',(str(request_id or ''),store.now(),'returned',json.dumps(usage,default=str),event))
    return response

def safe_cell(value):
    text=str(value if value is not None else '')
    return "'"+text if text.startswith(('=','+','-','@','\t','\r')) else text

def install(app):
    @app.get('/api/projects/benchmark.csv')
    def benchmark_export():
        import creator_portal
        if not creator_portal.is_admin():abort(403,'Administrator access is required.')
        output=io.StringIO();writer=csv.writer(output)
        fields=['record_type','event_id','feature','provider','model','request_or_job_id','started_utc','finished_utc','status','input_tokens','output_tokens','usage_json','estimated_cost_usd','cost_basis','actual_seconds','width','height','prompt','references_json','accepted_by_reviewer','review_notes','provider_confirmed_charge_usd','billing_evidence']
        writer.writerow(fields)
        def row(values):writer.writerow([safe_cell(values.get(k,'')) for k in fields])
        with store.connect() as c:
            init(c);events=c.execute('SELECT * FROM usage_ledger ORDER BY started,rowid').fetchall()
        for eid,feature,provider,model,rid,started,finished,status,usage in events:
            data=json.loads(usage or '{}')
            row({'record_type':'api_request','event_id':eid,'feature':feature,'provider':provider,'model':model,'request_or_job_id':rid,'started_utc':started,'finished_utc':finished,'status':status,'input_tokens':data.get('input_tokens',''),'output_tokens':data.get('output_tokens',''),'usage_json':usage,'cost_basis':'Provider-reported usage only; reconcile charges with provider export'})
        meta=store.get('job_meta',{})
        for jid,created,prompt,status,summary,asset in store.jobs():
            data=meta.get(jid,{});info=data.get('video_info',{});quote=data.get('cost_estimate',{})
            row({'record_type':'video_job','provider':data.get('provider'),'model':data.get('runway_model') or quote.get('model'),'request_or_job_id':data.get('task_id',jid),'started_utc':created,'finished_utc':data.get('completed_utc',''),'status':status,'usage_json':json.dumps(data.get('usage',{})),'estimated_cost_usd':quote.get('estimated_cost_usd'),'cost_basis':'Published-rate estimate; not provider-confirmed charge','actual_seconds':info.get('duration_seconds') or data.get('duration_seconds'),'width':info.get('width'),'height':info.get('height'),'prompt':prompt,'references_json':json.dumps(data.get('references',{}))})
        with creator_portal.db() as c:
            tasks=c.execute('SELECT * FROM background_tasks WHERE user_id=? AND project_id=? ORDER BY created,rowid',(creator_portal.user()['id'],creator_portal.g.project_id)).fetchall()
        for task in tasks:row({'record_type':'background_task','event_id':task['id'],'feature':task['label'],'started_utc':task['started'] or task['created'],'finished_utc':task['finished'],'status':task['status'],'cost_basis':'App task timing; not an additional provider charge'})
        return send_file(io.BytesIO(output.getvalue().encode('utf-8-sig')),mimetype='text/csv',as_attachment=True,download_name='aim_benchmark_'+store.now()[:10]+'.csv')
