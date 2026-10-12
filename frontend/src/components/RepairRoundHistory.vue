<script setup lang="ts">
import {ref,watch,onScopeDispose} from 'vue';
import {useI18n} from 'vue-i18n';
import {isAbortError,type PageResult} from '../api';
import type {FaultEvent,RepairRound} from '../types';
import type {RequestFn} from '../page-context';
import {formatSystemDateTime} from '../system-settings';
const props=defineProps<{fault:FaultEvent;request:RequestFn}>();
const emit=defineEmits<{select:[round:RepairRound]}>();
const {t}=useI18n();const rows=ref<RepairRound[]>([]);const total=ref(0);const page=ref(1);const loading=ref(false);const error=ref('');
let controller:AbortController|null=null;let version=0;
async function load(){
 const token=++version;const faultId=props.fault.id;controller?.abort();controller=new AbortController();loading.value=true;error.value='';
 try{
  const data=await props.request<PageResult<RepairRound>>(`/repair-records/?fault=${faultId}&ordering=-round_number&page=${page.value}&page_size=10`,{signal:controller.signal});
  if(token!==version||props.fault.id!==faultId)return;
  rows.value=data.results;total.value=data.count;
 }catch(failure){if(token===version&&!isAbortError(failure))error.value=failure instanceof Error?failure.message:String(failure);}
 finally{if(token===version)loading.value=false;}
}
function move(step:number){page.value=Math.max(1,page.value+step);void load();}
watch(()=>[props.fault.id,props.fault.repair_round_count],()=>{page.value=1;rows.value=[];void load();},{immediate:true});
onScopeDispose(()=>{++version;controller?.abort();});
</script>
<template>
 <section class="repair-round-history">
  <h3>{{t('repairRounds.title')}}</h3>
  <p>{{t('repairRounds.explanation')}}</p>
  <p v-if="error">{{error}} <el-button link @click="load">{{t('common.retry')}}</el-button></p>
  <p v-if="loading">{{t('common.loading')}}</p>
  <p v-else-if="!rows.length">{{t('repairRounds.empty')}}</p>
  <article v-for="round in rows" :key="round.id" class="repair-round-history__row">
   <div><strong>{{t('repairRounds.number',{number:round.round_number || 1})}}</strong> · {{round.finished_at?t('repairRounds.finished'):t('repairRounds.open')}} <span v-if="round.is_current">· {{t('repairRounds.current')}}</span> <span v-if="round.origin==='legacy'">· {{t('repairRounds.legacy')}}</span></div>
   <p>{{round.provider || t('common.notAvailable')}} · {{t('repairRounds.cost')}}: {{round.cost ?? t('common.notAvailable')}}</p>
   <p>{{formatSystemDateTime(round.started_at)}} → {{formatSystemDateTime(round.finished_at)}}</p>
   <p>{{t('repairRounds.openedBy')}}: {{round.opened_by_name || t('common.notAvailable')}} · {{t('repairRounds.completedBy')}}: {{round.completed_by_name || t('common.notAvailable')}}</p>
   <el-button link :disabled="loading || fault.repair?.id===round.id" @click="emit('select',round)">{{t('repairRounds.select')}}</el-button>
  </article>
  <div v-if="total>10"><el-button :disabled="page===1||loading" @click="move(-1)">{{t('common.previous')}}</el-button> {{page}} / {{Math.ceil(total/10)}} <el-button :disabled="page*10>=total||loading" @click="move(1)">{{t('common.next')}}</el-button></div>
  <p v-if="fault.repair">{{t('repairRounds.selected',{number:fault.repair.round_number || 1})}}</p>
 </section>
</template>
<style scoped>
.repair-round-history { margin-bottom:20px; padding:16px; border:1px solid var(--el-border-color); border-radius:8px; }
.repair-round-history__row { border-top:1px solid var(--el-border-color-light); padding:12px 0; }
.repair-round-history p { color:var(--el-text-color-secondary); overflow-wrap:anywhere; margin:8px 0; }
</style>
