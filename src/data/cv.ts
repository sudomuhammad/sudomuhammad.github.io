// Single source of truth for page content, taken from my CV.

export type ClusterId = 'agents' | 'retrieval' | 'data' | 'shipping';

export interface Cluster {
  id: ClusterId;
  name: string;
  summary: string;
  color: string;
  /** Centre in map space (0–1), placed asymmetrically to the right of the intro column. */
  centre: [number, number];
  /** Terms drawn as labelled points inside the cluster. */
  terms: string[];
}

export const clusters: Cluster[] = [
  {
    id: 'agents',
    name: 'Agents and LLM products',
    summary: 'Language-model agents inside real products: tool choice, memory, context and evaluation.',
    color: '#FF6A4D',
    centre: [0.66, 0.3],
    terms: [
      'tool selection', 'conversation flow', 'prompt caching', 'model routing',
      'structured output', 'regression evals', 'rolling summary', 'CrewAI',
      'Agent Framework', 'Pydantic', 'Azure AI Foundry', 'failover',
    ],
  },
  {
    id: 'retrieval',
    name: 'Retrieval and RAG',
    summary: 'Grounding models in the right data so answers stay accurate.',
    color: '#7392FF',
    centre: [0.83, 0.52],
    terms: [
      'RAG', 'Qdrant', 'Pinecone', 'Azure AI Search', 'LangChain',
      'Hugging Face', 'embeddings', 'Redis',
    ],
  },
  {
    id: 'data',
    name: 'Data science and ML',
    summary: 'Modelling, analytics and NLP, from research briefs to production dashboards.',
    color: '#38C290',
    centre: [0.5, 0.6],
    terms: [
      'TensorFlow', 'NLP', 'transfer learning', 'Dash', 'scikit-learn',
      'PostgreSQL', 'MongoDB', 'CNNs', 'sentiment analysis', 'statistics',
    ],
  },
  {
    id: 'shipping',
    name: 'Shipping to production',
    summary: 'Getting models into people’s hands: APIs, containers, pipelines and observability.',
    color: '#E9B032',
    centre: [0.72, 0.8],
    terms: [
      'Docker', 'AWS Fargate', 'AWS CDK', 'CircleCI', 'Flask APIs',
      'OpenTelemetry', 'C#', 'Python', 'Linux', 'Oracle',
    ],
  },
];

export interface Role {
  title: string;
  org: string;
  place?: string;
  start: string;
  end: string;
  context: string;
  points: { text: string; cluster: ClusterId }[];
  tech: string[];
}

export const roles: Role[] = [
  {
    title: 'AI Engineer',
    org: 'Money Means',
    start: '08/2025',
    end: 'Present',
    context:
      'Aida is an AI financial adviser. I’m responsible for the parts of it that understand what a user says, remember it, and use it in later conversations.',
    points: [
      { cluster: 'agents', text: 'Own the language-model agent behind Aida’s chat: tool selection, conversation flow, and how facts a user shares are captured and reused.' },
      { cluster: 'agents', text: 'Replaced a multi-call extraction loop with a single-call design that is markedly faster, with no loss in accuracy.' },
      { cluster: 'agents', text: 'Designed the step that decides which tools the model sees for each message, so it picks the right one far more often.' },
      { cluster: 'agents', text: 'Introduced prompt caching across all model calls by separating the fixed and per-turn parts of each prompt.' },
      { cluster: 'agents', text: 'Set the patterns the team builds agent tools against: a typed contract per tool, structured JSON output per model call, and one place that defines what each tool needs before it can run.' },
      { cluster: 'retrieval', text: 'Designed how the agent reads and writes financial data: typed profile writes behind a confidence threshold, tools gated on what the user’s accounts contain, and no unvalidated writes from the model.' },
      { cluster: 'agents', text: 'Own what the model sees each turn (history, rolling summary, user profile) so accuracy holds as conversations grow.' },
      { cluster: 'shipping', text: 'Routed models per task, a small model for classification and tool selection and a larger one for the reply, with automatic failover; migrated services between model generations without regressions.' },
      { cluster: 'agents', text: 'Built automated regression testing for the agent: fixed conversation datasets with expected tool calls and outputs, run on every prompt, tool and model change.' },
      { cluster: 'shipping', text: 'Built a prompt-assembly visualiser that shows exactly what the model saw on any turn.' },
    ],
    tech: ['C#', 'Python', 'Pydantic', 'CrewAI', 'Microsoft Agent Framework', 'Azure AI Search', 'Azure AI Foundry', 'Redis', 'OpenTelemetry'],
  },
  {
    title: 'Full Stack Data Scientist',
    org: 'VUE group',
    start: '11/2023',
    end: '07/2025',
    context: 'Data science and backend work for a vehicle fleet business: research, proof-of-concept builds and analytics for internal teams.',
    points: [
      { cluster: 'agents', text: 'Developed and deployed conversational data-visualisation services using LLMs and Dash, so non-technical users could query real-time analytics in plain language.' },
      { cluster: 'data', text: 'Evaluated new AI tools and wrote research briefs that senior leadership used to decide what to invest in.' },
      { cluster: 'data', text: 'Built a vehicle utilisation and monitoring system that cut manual reporting by 70%.' },
      { cluster: 'data', text: 'Ran statistical modelling and exploratory analysis across MSSQL, PostgreSQL and MongoDB.' },
      { cluster: 'shipping', text: 'Migrated databases from MSSQL to PostgreSQL with no data loss, improving query performance.' },
      { cluster: 'shipping', text: 'Managed deployment pipelines with CircleCI and Docker, reducing release times.' },
    ],
    tech: ['Python', 'AWS', 'LLMs', 'NLP', 'TensorFlow', 'Docker', 'n8n', 'Hugging Face', 'LangChain', 'CircleCI', 'PostgreSQL', 'MongoDB'],
  },
  {
    title: 'Co-founder',
    org: 'Innervoices S.L.',
    start: '02/2023',
    end: '11/2023',
    context:
      'A start-up building a web product that helped people talk through personal issues from both an emotional and a rational perspective. I owned the backend and deployment in a small team; we paused in late 2023 when funding ran out.',
    points: [
      { cluster: 'shipping', text: 'Built Flask REST APIs backed by MongoDB and deployed them on AWS Fargate.' },
      { cluster: 'agents', text: 'Used open-source language models for the product’s AI features, and curated the datasets behind them.' },
      { cluster: 'retrieval', text: 'Built retrieval-augmented generation with Qdrant and Pinecone, reducing hallucinations.' },
      { cluster: 'shipping', text: 'Containerised the services with Docker and deployed with AWS CDK and Fargate, with SSL for HTTPS.' },
    ],
    tech: ['Python', 'React', 'MongoDB', 'Qdrant', 'Pinecone', 'AWS', 'Docker', 'LangChain', 'pytest', 'SageMaker'],
  },
  {
    title: 'Data Scientist',
    org: 'Plenty',
    place: 'Barcelona',
    start: '10/2021',
    end: '04/2022',
    context: 'Python, machine learning and deep learning to speed up data collection and research at an early-stage start-up.',
    points: [
      { cluster: 'data', text: 'Developed a Python web scraper that collected over half a million descriptions and stock quotes.' },
      { cluster: 'data', text: 'Designed and implemented machine-learning models on my own, reaching over 90% accuracy.' },
      { cluster: 'data', text: 'Tested image-processing models using CNN architectures (VGG-16, Inception).' },
    ],
    tech: ['Python', 'SageMaker', 'Google Colab', 'TensorFlow', 'Hugging Face'],
  },
  {
    title: 'System Support Engineer',
    org: 'Techaccess',
    place: 'Pakistan',
    start: '01/2018',
    end: '10/2020',
    context: 'Technical support and IT services for clients, specialising in Oracle databases and Linux systems.',
    points: [
      { cluster: 'shipping', text: 'Set up, administered and tuned Oracle RDBMS and Linux systems for client environments.' },
      { cluster: 'shipping', text: 'Ran database backup and recovery using RMAN and Data Pump.' },
    ],
    tech: ['Oracle RDBMS', 'Red Hat Linux', 'SQL', 'VMware'],
  },
];

export const education = [
  {
    degree: 'MSc Artificial Intelligence & Applications',
    org: 'University of Strathclyde',
    start: '09/2020',
    end: '09/2021',
    note: 'Thesis: NLP sentiment analysis using deep learning and transfer learning to work around limited training data.',
  },
  {
    degree: 'BSc Electrical Engineering',
    org: 'National University of Computer and Emerging Sciences',
    start: '09/2012',
    end: '09/2016',
  },
];

export const person = {
  name: 'Muhammad Uzair',
  role: 'AI Engineer',
  line: 'I build AI that people talk to.',
  summary:
    'Five years in data science and machine learning, the last three putting language models into products. Currently Aida, an AI financial adviser, where the answers have to be right as well as fast. I like problems where the model is only half the job; the rest is making it quick, keeping the data honest, and getting it into people’s hands.',
  location: 'UK, open to relocation',
  email: 'uzaiirr@outlook.com',
  linkedin: 'https://www.linkedin.com/in/muhammaduzair94',
  cv: '/Muhammad_Uzair_CV.pdf',
  languages: 'English (fluent), Urdu and Pashto (native)',
};
