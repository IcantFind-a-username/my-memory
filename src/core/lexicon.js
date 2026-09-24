// Bilingual (zh/en) concept lexicon. This is the "semantic" layer of the MVP:
// surface words map to a small controlled vocabulary, so "麻木" and "numb"
// meet at the same concept without an embedding model, a download, or a
// second copy of the user's data in vector form.

// Self-reported state dimensions. q = quality dim (poor/good); otherwise an
// intensity dim (high/low). `code` values are what the AI sees.
export const DIMS = {
  sleep: { q: true, code: { poor: 'sleep:poor', good: 'sleep:good' }, zh: { poor: '睡得差', good: '睡得好', name: '睡眠' }, en: { poor: 'poor sleep', good: 'good sleep', name: 'sleep' } },
  mood: { q: true, code: { poor: 'mood↓', good: 'mood↑' }, zh: { poor: '情绪低落', good: '情绪不错', name: '情绪' }, en: { poor: 'low mood', good: 'good mood', name: 'mood' } },
  energy: { q: true, code: { poor: 'energy↓', good: 'energy↑' }, zh: { poor: '很累', good: '有精神', name: '精力' }, en: { poor: 'exhaustion', good: 'good energy', name: 'energy' } },
  focus: { q: true, code: { poor: 'focus↓', good: 'focus↑' }, zh: { poor: '注意力差', good: '注意力好', name: '注意力' }, en: { poor: 'poor focus', good: 'good focus', name: 'focus' } },
  appetite: { q: true, code: { poor: 'appetite↓', good: 'appetite↑' }, zh: { poor: '没胃口', good: '胃口好', name: '食欲' }, en: { poor: 'low appetite', good: 'good appetite', name: 'appetite' } },
  numb: { q: false, code: { high: 'numb↑', low: 'numb↓' }, zh: { high: '麻木', low: '麻木减轻', name: '麻木' }, en: { high: 'numbness', low: 'less numbness', name: 'numbness' } },
  unreal: { q: false, code: { high: 'unreal↑', low: 'unreal↓' }, zh: { high: '不真实感', low: '不真实感减轻', name: '不真实感' }, en: { high: 'feeling unreal', low: 'feeling more real', name: 'feeling unreal' } },
  memgap: { q: false, code: { high: 'memgap↑', low: 'memgap↓' }, zh: { high: '记忆空白', low: '记忆好些', name: '记忆空白' }, en: { high: 'memory gaps', low: 'fewer memory gaps', name: 'memory gaps' } },
  anxiety: { q: false, code: { high: 'anxiety↑', low: 'anxiety↓' }, zh: { high: '焦虑', low: '焦虑减轻', name: '焦虑' }, en: { high: 'anxiety', low: 'less anxiety', name: 'anxiety' } },
  stress: { q: false, code: { high: 'stress↑', low: 'stress↓' }, zh: { high: '压力大', low: '压力小些', name: '压力' }, en: { high: 'stress', low: 'less stress', name: 'stress' } },
  lonely: { q: false, code: { high: 'lonely↑', low: 'lonely↓' }, zh: { high: '孤独', low: '没那么孤独', name: '孤独' }, en: { high: 'loneliness', low: 'less lonely', name: 'loneliness' } },
  irritable: { q: false, code: { high: 'irritable↑', low: 'irritable↓' }, zh: { high: '烦躁', low: '平和些', name: '烦躁' }, en: { high: 'irritability', low: 'calmer', name: 'irritability' } },
  pain: { q: false, code: { high: 'body_pain↑', low: 'body_pain↓' }, zh: { high: '身体不适', low: '身体好些', name: '身体不适' }, en: { high: 'physical pain', low: 'less pain', name: 'physical pain' } },
};

// [pattern, dim, value]. A negation right before a match flips it
// ("不那么焦虑" -> anxiety low); so does an easing word right after ("焦虑少了").
export const SIGNALS = [
  [/失眠|睡不着|睡不好|没睡好|没怎么睡|整夜没睡|熬夜|半夜(醒|惊醒)|早醒|睡得(很|非常|特别|太|有点|比较|超)?(差|不好|少|浅|糟)|睡眠(很|非常|特别|太|有点|比较|超)?(差|不好|不足|糟|少)|insomnia|can'?t sleep|couldn'?t sleep|no sleep|not sleeping|haven'?t (been )?(slept|sleeping)|(sleep|sleeping|slept)\s+(so |really |very )?(badly|poorly|terribly|little|bad|awful|poor)|(poor|bad|terrible) sleep/i, 'sleep', 'poor'],
  [/睡得(很|挺|还|超)?(好|香|不错|踏实)|睡眠(很|挺|还)?(好|不错)|睡了个好觉|(sleep|sleeping|slept)\s+(so |really |very )?(well|great|good)|good (night'?s )?sleep/i, 'sleep', 'good'],
  [/(情绪|心情)(很|非常|特别|有点|比较|超)?(低落|差|不好|糟|沉重)|低落|难过|沮丧|抑郁|郁闷|伤心|想哭|哭了|绝望|心里(很|有点)?(难受|堵)|很丧|好丧|\b(sad|depressed|hopeless|miserable|crying|cried)\b|feel(ing)? (so |really |very )?down|low mood/i, 'mood', 'poor'],
  [/心情(很|挺|还)?(好|不错)|开心|高兴|快乐|愉快|平静|\b(happy|calm|joyful)\b|good mood/i, 'mood', 'good'],
  [/(很|好|太|特别|有点|非常|超|觉得|感觉)累|累死|累坏|累了|疲惫|疲倦|疲劳|没力气|没精神|没劲|乏力|起不来床|\b(exhausted|tired|fatigued?|drained)\b|no energy/i, 'energy', 'poor'],
  [/精力(充沛|很好|不错)|有精神|有劲|\b(energetic|energi[sz]ed)\b/i, 'energy', 'good'],
  [/注意力(不集中|差|很差)|集中不了|无法集中|没法集中|分心|走神|脑子(很)?(乱|糊|转不动)|脑雾|can'?t (focus|concentrate)|brain fog|\bdistracted\b/i, 'focus', 'poor'],
  [/没胃口|吃不下|不想吃(饭|东西)|食欲(差|不好|不振)|no appetite|can'?t eat/i, 'appetite', 'poor'],
  [/麻木|木木的|整个人木了|没(有)?感觉|感觉不到|空洞|空空的|行尸走肉|\bnumb(ness)?\b|empty inside|\bhollow\b|feel nothing|can'?t feel/i, 'numb', 'high'],
  [/解离|不真实|像在做梦|像做梦|灵魂出窍|抽离|隔着一层|不像我自己|dissociat|dereali[sz]ation|depersonali[sz]ation|\bunreal\b|\bdetached\b|out of (my )?body|not real/i, 'unreal', 'high'],
  [/想不起(来)?|记不起(来)?|记不住|断片|失去(了)?时间|记忆(空白|断了|丢了)|丢了一段|lost time|can'?t remember|memory gaps?|blank(ed)? out/i, 'memgap', 'high'],
  [/焦虑|紧张|心慌|恐慌|害怕|担心|不安|\b(panic|anxious|anxiety|nervous|worried|scared|afraid)\b/i, 'anxiety', 'high'],
  [/压力(很|好|太|特别)?大|崩溃|撑不住|扛不住|overwhelm|\bstress(ed)?\b|burn(ed|t)? out/i, 'stress', 'high'],
  [/孤独|孤单|寂寞|没人(理|懂|说话)|\b(lonely|isolated)\b/i, 'lonely', 'high'],
  [/烦躁|易怒|暴躁|想发火|发脾气|烦死|\b(irritable|angry|annoyed|furious)\b/i, 'irritable', 'high'],
  [/头(疼|痛)|胃(疼|痛)|肚子(疼|痛)|身体(不舒服|难受)|headache|stomach ?ache|body aches?/i, 'pain', 'high'],
];

export const NEG_BEFORE = /(不是|并不|并没有?|(不|没)(觉得|感觉|感到|有)|不|别|没有?|没那么|不那么|不再|不太|不怎么|no longer|not|n't|never|less|(don'?t|do not|didn'?t|doesn'?t) (feel|get|think i'?m))\s*(很|太|那么|怎么|特别|非常|多|so|very|too|that)?\s*$/i;
export const NEG_AFTER = /^\s*(感|的感觉)?\s*(少了|轻了|减轻|缓解|好(多|些|一点|点)了|消失|没了|淡了|消退|went away|eased|is gone|faded|lifted|any ?more)/i;
// Uncertain or asked, not reported: "我不确定是不是麻木", "maybe I'm numb?" -> record nothing.
export const HEDGE_BEFORE = /(是不是|会不会|有没有|算不算|不确定|不知道是不是|\bmaybe\b|\bmight be\b|not sure (if|whether)( i'?m)?|\bam i\b)\s*(很|有点|特别)?\s*$/i;
// Expectation, not outcome: "我以为跑步会有用" says nothing about whether it helped.
export const EXPECT = /以为|本来想|原本想|希望|期待|可能会|应该会|会不会|\bthought (it|that|this) (would|might)\b|\bhoped\b|\bexpected\b/i;

// Things the user did that may help. `re` finds a mention; whether it helped
// comes from EFFECTS. meds is always sensitive.
export const STRATEGIES = {
  walk: { zh: '散步', en: 'walking', re: /散步|走路|走走|走了走|出去走|溜达|遛弯|\bwalk(ed|ing|s)?\b/i },
  exercise: { zh: '运动', en: 'exercise', re: /运动|跑步|健身|瑜伽|游泳|骑车|爬山|拉伸|exercis|workout|\bran\b|\bruns?\b|\brunning\b|\bjog|\byoga\b|\bswim|stretch/i },
  sunlight: { zh: '晒太阳/去户外', en: 'sunlight/outdoors', re: /晒(了)?.{0,4}太阳|阳光|户外|公园|大自然|sunlight|sunshine|outdoors|\bpark\b|nature/i },
  music: { zh: '听音乐', en: 'music', re: /听歌|听音乐|音乐|唱歌|\bmusic\b|\bsongs?\b|\bsing(ing)?\b/i },
  talk: { zh: '和人聊聊', en: 'talking to someone', re: /聊天|聊了|倾诉|打电话|打了电话|视频通话|见(了)?朋友|(跟|和).{1,6}(聊|说|倾诉)|talk(ed|ing)? (to|with)|call(ed)? (my|a) |\btexted\b|saw (a |my )?friend/i },
  shower: { zh: '洗澡', en: 'shower/bath', re: /洗澡|泡澡|淋浴|洗(了)?个?热水|\bshower|\bbath\b/i },
  breathe: { zh: '呼吸练习', en: 'breathing', re: /深呼吸|呼吸练习|腹式呼吸|4-7-8|box breathing|\bbreath(e|ing)\b/i },
  ground: { zh: '着陆练习', en: 'grounding', re: /5-?4-?3-?2-?1|着陆|接地|冷水|冰块|握(着)?冰|grounding|ice cubes?|cold water/i },
  journal: { zh: '写下来', en: 'journaling', re: /写日记|日记|写下来|写了点东西|\bjournal|\bwrote\b|\bwriting\b/i },
  rest: { zh: '休息', en: 'rest', re: /休息|午睡|小睡|躺(了|一会)|\bnap\b|\brest(ed)?\b/i },
  eat: { zh: '好好吃饭', en: 'eating a meal', re: /吃(了)?(点东西|顿饭|饭|早餐|早饭|午饭|晚饭)|好好吃饭|\bate\b|a (proper )?meal/i },
  pet: { zh: '陪宠物', en: 'time with a pet', re: /撸猫|撸狗|遛狗|宠物|猫咪|狗狗|my (cat|dog)|\bpets?\b/i },
  meds: { zh: '按医嘱用药', en: 'medication', re: /吃药|服药|药物|\bmedication\b|\bmeds\b|my pills/i, sensitive: true },
  therapy: { zh: '心理咨询', en: 'therapy', re: /心理咨询|咨询师|治疗师|看医生|\btherap|\bcounsel/i },
};

// Order matters: "没有帮助" must be read as 0 before "有帮助" as +1.
export const EFFECTS = [
  [-1, /更(糟|差|难受|焦虑|累|乱)|变糟|变差|\bworse\b/i],
  [0, /没(有)?(什么)?用|不太有用|没效果|没(有)?(什么)?帮助|没(什么)?变化|不管用|didn'?t help|no (difference|effect)|did nothing|\buseless\b/i],
  [2, /好多了|很有用|很有帮助|非常有用|明显(好|改善)|帮了大忙|much better|helped a lot|really helped|so much better/i],
  [1, /(没|不)(那么|有那么)[\u4e00-\u9fff]{1,3}了|(舒服|好受|轻松|平静|放松|好)(了)?(一)?(点|些)|稍微好|有点用|有(一)?点帮助|缓解|好转|有帮助|有用|(a bit|a little|slightly|somewhat) better|\bhelped\b|felt better|better after/i],
];

// [pattern, days back, span in days]. Checked in order.
export const WHEN = [
  [/前天|day before yesterday/i, 2, 1],
  [/昨天|昨晚|昨夜|\byesterday\b|last night/i, 1, 1],
  [/今天|今日|今晚|今早|\btoday\b|\btonight\b|this morning/i, 0, 1],
  [/上周|上个?星期|上个?礼拜|last week/i, 7, 7],
  [/上个?月|last month/i, 30, 30],
  [/最近|这几天|这些天|这段时间|近来|这阵子|这周|\blately\b|\brecently\b|these days|this week|past few days/i, 0, 7],
];
export const WHEN_N = /([0-9]+|[一二两三四五六七八九十]+)\s*天前|\b([0-9]+) days? ago/i;

// Whole-utterance kinds: saved as one item, not split into clauses.
export const KIND_CUES = [
  ['future_message', /给(未来|以后|将来)的(我|自己)|(未来|以后|将来)的(我|自己)\s*[，,:：]|to (my )?future (me|self)|dear future me|future self/i],
  ['support_plan', /(危机|支持|安全|应急)计划|撑不住的时候(可以|就|要)|紧急联系人|(safety|support|crisis) plan|emergency contact|when i can'?t cope/i],
  ['anchor', /现实锚点|锚点|提醒(我)?自己|reality anchor|\banchor\b|remind (me|myself) that/i],
  ['relationship', /(是|算是)我(的)?(可以|能)?(信任|信赖|最好)的|(可以|能)信任|我(和|跟).{1,8}的关系|is (someone|a person) i (can )?trust|my (safe|trusted) person|relationship with/i],
  ['reflection', /我(发现|意识到|明白了|想明白|想通了|学到)|反思|复盘|\bi (realized|realised|noticed|learned|figured out)\b/i],
];

export const KINDS = ['event', 'state', 'reflection', 'anchor', 'coping', 'future_message', 'relationship', 'support_plan'];

// Epistemic status of the user's words for each kind. Nothing here is ever
// "fact": events are the user's record, states are self-report.
export const EPISTEMIC = {
  event: 'user_record',
  state: 'self_report',
  reflection: 'self_report',
  anchor: 'user_record',
  coping: 'self_report',
  future_message: 'user_record',
  relationship: 'self_report',
  support_plan: 'user_record',
};

export const PEOPLE = /妈妈|母亲|爸爸|父亲|家人|姐姐|哥哥|妹妹|弟弟|朋友|室友|同学|同事|老板|领导|老师|医生|咨询师|伴侣|男朋友|女朋友|对象|老公|老婆|丈夫|妻子|孩子|女儿|儿子|\b(mom|mother|dad|father|sister|brother|friend|roommate|partner|boyfriend|girlfriend|husband|wife|boss|teacher|doctor|therapist|son|daughter)\b/gi;

export const FEEL = /觉得|感觉|感到|心里|情绪|状态|\bfeel(ing)?s?\b|\bfelt\b/i;

export const CRISIS = /自杀|轻生|不想活|活不下去|想死|去死|结束(自己的)?生命|结束一切|伤害自己|自残|自伤|割腕|跳楼|吞药|suicid|kill myself|end my life|end it all|want to die|don'?t want to live|self[- ]?harm|hurt myself/i;
export const SENSITIVE = /创伤|虐待|家暴|性侵|强奸|侵犯|骚扰|诊断|确诊|病历|住院|精神科|药物|吃药|服药|剂量|喝酒|喝醉|酒精|毒品|trauma|abuse|assault|\brape|harass|diagnos|hospital|psychiatr|medication|\bdose\b|alcohol|drunk|\bdrugs?\b/i;
export const RESTRICT = /只给我自己看|别给\s*AI|不要给\s*AI|不要让\s*AI|仅自己可见|私密|保密|only for me|keep (this |it )?private|don'?t show (this |it )?to (the |any )?ai/i;
export const IMPORTANT = /很重要|重要的|一定要记住|别忘了|千万|\bimportant\b|don'?t forget|must remember/i;
export const COMMAND = /^\s*(请)?(帮我)?(记住|记下来|记下|记一下|保存一下|保存|存一下)[\s,，:：。.!！]*|^\s*(please\s+)?(remember|save|note)( this| that)?[\s,:.!-]*(that\s+)?/i;

// The AI may never attach a diagnosis to the user's memory.
export const DIAGNOSIS = /抑郁症|双相|躁郁|障碍|精神分裂|人格|创伤后应激|强迫症|多动症|自闭|ptsd|\bdid\b|bipolar|disorder|schizo|borderline|\bbpd\b|depressi(on|ve)|\b(mdd|gad|ocd|adhd)\b|autis|psychos|diagnos/i;

// Canonical English aliases the AI may use in tags: "sleep:poor", "walk:helped".
export const DIM_ALIAS = {
  sleep: 'sleep', mood: 'mood', energy: 'energy', focus: 'focus', appetite: 'appetite',
  numb: 'numb', numbness: 'numb', unreal: 'unreal', dissociation: 'unreal', derealization: 'unreal',
  memgap: 'memgap', memory: 'memgap', anxiety: 'anxiety', anxious: 'anxiety', stress: 'stress',
  lonely: 'lonely', loneliness: 'lonely', irritable: 'irritable', irritability: 'irritable', pain: 'pain',
};
export const STRATEGY_ALIAS = {
  walk: 'walk', walking: 'walk', exercise: 'exercise', running: 'exercise', yoga: 'exercise',
  sunlight: 'sunlight', outdoors: 'sunlight', music: 'music', talk: 'talk', talking: 'talk',
  shower: 'shower', bath: 'shower', breathe: 'breathe', breathing: 'breathe', ground: 'ground',
  grounding: 'ground', journal: 'journal', journaling: 'journal', writing: 'journal', rest: 'rest',
  nap: 'rest', eat: 'eat', eating: 'eat', pet: 'pet', meds: 'meds', medication: 'meds', therapy: 'therapy',
};

// Query intents (see query.js for how they combine).
export const QUERY = {
  recent: /最近(发生|怎么|过得|的我|我)|我最近|这(几天|些天|段时间|周|阵子)|近况|what('s| has)( been)? happen|\brecently\b|\blately\b|this week|past few days|how have i been/i,
  similar: /上次|上一次|以前(也|有过)|之前(也|有过)|又(开始|觉得|感觉|这样|来了|是|很)|类似|像.{0,6}(那次|那时|之前)|last time|happened before|\bagain\b|\bsimilar\b/i,
  helped: /(什么|哪些|啥|怎么|怎样).{0,8}(有用|有帮助|帮到|管用|有效|缓解|好一点|好起来|好受)|怎么办|what (helped|helps|works|worked)|what can i do|how (do|can) i cope|\bcope\b/i,
  anchors: /我是谁|今天(是)?(几号|星期几|哪天)|现在是(哪年|几月)|我在哪|现实锚点|锚点|不真实|\bgrounding\b|who am i|what day is|where am i|am i real|\banchors?\b/i,
  future: /给未来(的)?(我|自己)|未来的我|过去的我|以前的我(说|留)|(给我的|的)留言|message (to|from) (my )?(future|past) (self|me)|note to (my )?(future )?self/i,
  support: /支持计划|安全计划|危机计划|紧急联系人|可以找谁|能找谁|(safety|support|crisis) plan|who can i (call|reach|talk)/i,
  search: /记得.{0,10}吗|我(之前|以前|上次)?(说过|提过|记过|记录过)|之前记|查(一下|查)?我的记忆|do you remember|did i (say|mention|note)|remind me (what|when|about)|look (it )?up in my/i,
  why: /为什么|为啥|怎么回事|不知道怎么了|\bwhy\b|what'?s wrong with me/i,
  self: /我|自己|\b(i|i'm|i've|im|me|my|myself)\b/i,
  // Someone else is the subject: "他最近很焦虑" is not about the user.
  other: /^\s*(他|她|他们|她们|它|我(的)?(朋友|妈妈|爸爸|同事|家人|孩子|伴侣|男朋友|女朋友|老公|老婆))|^\s*(he|she|they|my (friend|mom|mother|dad|father|partner|kid|son|daughter|boss))\b/i,
};
