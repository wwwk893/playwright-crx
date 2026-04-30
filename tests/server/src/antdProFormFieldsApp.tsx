import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, Button, ConfigProvider, Form, Modal, Space, Table, Tag, Typography } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { PlusOutlined } from '@ant-design/icons';
import {
  ProCard,
  ProForm,
  ProFormCascader,
  ProFormCheckbox,
  ProFormDependency,
  ProFormDigit,
  ProFormList,
  ProFormRadio,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  ProFormTreeSelect,
} from '@ant-design/pro-components';
import type { FormListActionType, ProColumns } from '@ant-design/pro-components';
import 'antd/dist/reset.css';

type IPv4Pool = {
  id: string;
  name: string;
  wan: string;
  startIp: string;
  endIp: string;
};

type NetworkResource = {
  id: string;
  name: string;
  wan: string;
  poolType: string;
  scope?: string;
  egressPath?: string[];
  arpProxy?: boolean;
  healthCheck?: boolean;
  sourcePort?: number;
  mappings?: Array<{ serviceName?: string; listenPort?: number }>;
  remark?: string;
};

const wanOptions = [
  { label: 'xtest16:WAN1', value: 'xtest16-wan1' },
  { label: '34y43rt:WAN2', value: '34y43rt-wan2' },
  { label: 'edge-lab:WAN1', value: 'wan-1' },
  { label: 'edge-lab:WAN1-copy', value: 'wan-1-copy' },
  { label: 'edge-lab:WAN2', value: 'wan-2' },
  { label: 'edge-lab:WAN-disabled', value: 'wan-disabled', disabled: true },
  ...Array.from({ length: 36 }, (_, index) => ({ label: `edge-lab:WAN-extra-${index + 1}`, value: `wan-extra-${index + 1}` })),
];

const vrfOptions = [
  { label: '生产VRF', value: 'vrf-prod' },
  { label: '办公VRF', value: 'vrf-office' },
  { label: '灾备VRF', value: 'vrf-dr' },
];

const scopeTreeOptions = [
  {
    title: '全国站点',
    value: 'all-sites',
    children: [
      { title: '华东生产区', value: 'east-prod' },
      { title: '华南办公区', value: 'south-office' },
    ],
  },
  {
    title: '海外站点',
    value: 'global-sites',
    children: [
      { title: '新加坡边缘区', value: 'sg-edge' },
    ],
  },
];

const egressPathOptions = [
  {
    label: '上海',
    value: 'shanghai',
    children: [
      {
        label: '一号机房',
        value: 'sh-idc-1',
        children: [
          { label: 'NAT集群A', value: 'nat-a' },
          { label: 'NAT集群B', value: 'nat-b' },
        ],
      },
    ],
  },
  {
    label: '深圳',
    value: 'shenzhen',
    children: [
      {
        label: '二号机房',
        value: 'sz-idc-2',
        children: [
          { label: 'NAT集群C', value: 'nat-c' },
        ],
      },
    ],
  },
];

function labelFromOptions(options: Array<{ label: string; value: string }>, value: string) {
  return options.find(option => option.value === value)?.label || value;
}

function treeLabel(value?: string) {
  for (const group of scopeTreeOptions) {
    if (group.value === value)
      return group.title;
    const child = group.children.find(option => option.value === value);
    if (child)
      return child.title;
  }
  return value || '';
}

function cascaderLabels(values?: string[]) {
  const labels: string[] = [];
  let current: any[] | undefined = egressPathOptions;
  for (const value of values || []) {
    const option = current?.find(option => option.value === value);
    if (!option)
      break;
    labels.push(option.label);
    current = option.children;
  }
  return labels;
}

function AntDProFormFieldsApp() {
  const [open, setOpen] = React.useState(false);
  const [ipv4PoolOpen, setIpv4PoolOpen] = React.useState(false);
  const [rows, setRows] = React.useState<NetworkResource[]>([]);
  const [ipv4Pools, setIpv4Pools] = React.useState<IPv4Pool[]>([]);
  const [configSaved, setConfigSaved] = React.useState(false);
  const [form] = Form.useForm();
  const [ipv4PoolForm] = Form.useForm();
  const mappingActionRef = React.useRef<FormListActionType<{ serviceName?: string; listenPort?: number }>>();

  const ipv4PoolColumns: ProColumns<IPv4Pool>[] = [
    { title: '地址池名称', dataIndex: 'name' },
    { title: 'WAN口', dataIndex: 'wan', render: (_, row) => <Tag color="purple">{row.wan}</Tag> },
    { title: '开始地址', dataIndex: 'startIp' },
    { title: '结束地址', dataIndex: 'endIp' },
  ];

  const columns: ProColumns<NetworkResource>[] = [
    { title: '资源名称', dataIndex: 'name' },
    { title: 'WAN口', dataIndex: 'wan', render: (_, row) => <Tag color="blue">{row.wan}</Tag> },
    { title: '类型', dataIndex: 'poolType' },
    { title: '发布范围', dataIndex: 'scope' },
    { title: '出口路径', dataIndex: 'egressPath', render: (_, row) => row.egressPath?.join(' / ') },
    { title: '代理ARP', dataIndex: 'arpProxy', render: (_, row) => row.arpProxy ? '已开启' : '未开启' },
    { title: '健康检查', dataIndex: 'healthCheck', render: (_, row) => row.healthCheck ? '启用' : '关闭' },
    { title: '端口映射', dataIndex: 'mappings', render: (_, row) => row.mappings?.map(item => `${item.serviceName}:${item.listenPort}`).join(', ') },
    { title: '备注', dataIndex: 'remark' },
  ];

  async function saveIpv4Pool() {
    const values = await ipv4PoolForm.validateFields();
    const next: IPv4Pool = {
      id: `ipv4-pool-${Date.now()}`,
      name: values.name,
      wan: labelFromOptions(wanOptions, values.wan),
      startIp: values.startIp,
      endIp: values.endIp,
    };
    setIpv4Pools(current => [...current, next]);
    setIpv4PoolOpen(false);
    ipv4PoolForm.resetFields();
  }

  async function save() {
    const values = await form.validateFields();
    const next: NetworkResource = {
      id: `network-resource-${Date.now()}`,
      name: values.name,
      wan: labelFromOptions(wanOptions, values.wan),
      poolType: values.poolType,
      scope: treeLabel(values.scope),
      egressPath: cascaderLabels(values.egressPath),
      arpProxy: values.features?.includes('arpProxy'),
      healthCheck: values.healthCheck,
      sourcePort: values.sourcePort,
      mappings: values.mappings,
      remark: values.remark,
    };
    setRows(current => [...current, next]);
    setOpen(false);
    form.resetFields();
  }

  return <ConfigProvider locale={zhCN}>
    <App>

      <ProCard title="地址池与端口池" bordered data-testid="site-global-ip-pools-section" style={{ margin: 24 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Title level={4}>IP地址池</Typography.Title>
          <Space>
            <Button type="primary" data-testid="site-ip-address-pool-create-button" onClick={() => setIpv4PoolOpen(true)}>新建</Button>
            <Button data-testid="site-save-button" onClick={() => setConfigSaved(true)}>保存配置</Button>
            {configSaved ? <Tag color="green">配置已保存</Tag> : null}
          </Space>
          <Table<IPv4Pool>
            data-testid="site-ip-address-pool-table"
            rowKey="id"
            pagination={false}
            columns={ipv4PoolColumns as any}
            dataSource={ipv4Pools}
          />
        </Space>
      </ProCard>

      <Modal
        title="新建IPv4地址池"
        open={ipv4PoolOpen}
        destroyOnClose
        width={640}
        data-testid="ipv4-address-pool-modal"
        onCancel={() => setIpv4PoolOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setIpv4PoolOpen(false)}>取 消</Button>,
          <Button key="ok" type="primary" data-testid="ipv4-address-pool-confirm" onClick={saveIpv4Pool}>确 定</Button>,
        ]}
      >
        <ProForm
          form={ipv4PoolForm}
          submitter={false}
          layout="vertical"
          initialValues={{ poolType: 'shared' }}
          data-testid="ipv4-address-pool-form"
        >
          <ProFormText
            name="name"
            label="地址池名称"
            placeholder="地址池名称"
            rules={[{ required: true, message: '请输入地址池名称' }]}
          />
          <ProFormSelect
            name="wan"
            label="WAN口"
            placeholder="选择一个WAN口"
            options={wanOptions}
            allowClear={false}
            fieldProps={{
              showSearch: true,
              optionFilterProp: 'label',
            } as any}
            rules={[{ required: true, message: '选择一个WAN口' }]}
          />
          <ProFormRadio.Group
            name="poolType"
            label="类型"
            radioType="button"
            options={[
              { label: '共享地址池', value: 'shared' },
              { label: '独享地址池', value: 'dedicated' },
            ]}
          />
          <ProFormCheckbox name="arpProxy">开启代理ARP</ProFormCheckbox>
          <ProFormText
            name="startIp"
            label="开始地址，例如：192.168.1.1"
            placeholder="开始地址，例如："
            rules={[{ required: true, message: '请输入开始地址' }]}
          />
          <ProFormText
            name="endIp"
            label="结束地址，例如：192.168.1.254"
            placeholder="结束地址，例如："
            rules={[{ required: true, message: '请输入结束地址' }]}
          />
        </ProForm>
      </Modal>

      <ProCard title="网络配置资源" bordered data-testid="network-config-card" style={{ margin: 24 }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} data-testid="network-resource-add" onClick={() => setOpen(true)}>
              新建网络资源
            </Button>
            <Button data-testid="network-resource-refresh">刷新状态</Button>
          </Space>

          <Table<NetworkResource>
            data-testid="network-resource-table"
            rowKey="id"
            pagination={false}
            columns={columns as any}
            dataSource={rows}
          />
        </Space>
      </ProCard>

      <Modal
        title="新建网络资源"
        open={open}
        destroyOnClose
        width={760}
        data-testid="network-resource-modal"
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>取消</Button>,
          <Button key="ok" type="primary" data-testid="network-resource-save" onClick={save}>保存</Button>,
        ]}
      >
        <ProForm
          form={form}
          submitter={false}
          layout="vertical"
          initialValues={{ poolType: 'shared', sourcePort: 443, mappings: [{ serviceName: '', listenPort: undefined }] }}
          data-testid="network-resource-form"
        >
          <ProFormText
            name="name"
            label="资源名称"
            placeholder="地址池名称"
            rules={[{ required: true, message: '请输入资源名称' }]}
            fieldProps={{ 'data-testid': 'network-resource-name' } as any}
          />

          <div data-testid="network-resource-wan-field">
            <ProFormSelect
              name="wan"
              label="WAN口"
              placeholder="选择一个WAN口"
              options={wanOptions}
              allowClear={false}
              fieldProps={{
                'data-testid': 'network-resource-wan-select',
                showSearch: true,
                optionFilterProp: 'label',
              } as any}
              rules={[{ required: true, message: '选择一个WAN口' }]}
            />
          </div>

          <ProFormRadio.Group
            name="poolType"
            label="类型"
            radioType="button"
            options={[
              { label: '共享地址池', value: 'shared' },
              { label: '独享地址池', value: 'dedicated' },
            ]}
          />

          <ProFormSelect
            name="vrf"
            label="关联VRF"
            placeholder="选择一个VRF"
            options={vrfOptions}
            fieldProps={{
              'data-testid': 'network-resource-vrf-select',
              showSearch: true,
              optionFilterProp: 'label',
            } as any}
          />

          <ProFormCheckbox.Group
            name="features"
            label="能力开关"
            options={[
              { label: '开启代理ARP', value: 'arpProxy' },
              { label: '记录审计日志', value: 'auditLog' },
            ]}
          />

          <ProFormSwitch
            name="healthCheck"
            label="启用健康检查"
            fieldProps={{ 'data-testid': 'network-resource-health-switch' } as any}
          />

          <ProFormDependency name={['healthCheck']}>
            {({ healthCheck }) => healthCheck ? <ProFormText
              name="healthUrl"
              label="探测地址"
              placeholder="https://probe.example/health"
              rules={[{ required: true, message: '请输入探测地址' }]}
              fieldProps={{ 'data-testid': 'network-resource-health-url' } as any}
            /> : null}
          </ProFormDependency>

          <ProFormTreeSelect
            name="scope"
            label="发布范围"
            placeholder="选择发布范围"
            fieldProps={{
              'data-testid': 'network-resource-scope-tree',
              showSearch: true,
              treeData: scopeTreeOptions,
              treeDefaultExpandAll: true,
            } as any}
            rules={[{ required: true, message: '选择发布范围' }]}
          />

          <ProFormCascader
            name="egressPath"
            label="出口路径"
            placeholder="选择出口路径"
            fieldProps={{
              'data-testid': 'network-resource-egress-cascader',
              options: egressPathOptions,
            } as any}
            rules={[{ required: true, message: '选择出口路径' }]}
          />

          <Space>
            <Button data-testid="network-mapping-add" onClick={() => mappingActionRef.current?.add?.({ serviceName: '', listenPort: undefined })}>
              新增端口映射
            </Button>
          </Space>

          <ProFormList
            name="mappings"
            label="端口映射规则"
            actionRef={mappingActionRef}
            creatorButtonProps={false}
            itemRender={({ listDom, action }, { index }) => <ProCard bordered size="small" title={`端口映射 #${index + 1}`} extra={action} style={{ marginBlockEnd: 8 }}>{listDom}</ProCard>}
            rules={[{ required: true, message: '至少添加一条端口映射' }]}
          >
            <ProFormText
              name="serviceName"
              label="服务名称"
              placeholder="服务名称"
              rules={[{ required: true, message: '请输入服务名称' }]}
            />
            <ProFormDigit
              name="listenPort"
              label="监听端口"
              placeholder="监听端口"
              rules={[{ required: true, message: '请输入监听端口' }]}
            />
          </ProFormList>

          <ProFormDigit
            name="sourcePort"
            label="源端口"
            placeholder="例如：443"
            fieldProps={{ 'data-testid': 'network-resource-source-port' } as any}
          />

          <ProFormTextArea
            name="remark"
            label="备注"
            placeholder="填写策略备注"
            fieldProps={{ 'data-testid': 'network-resource-remark' } as any}
          />
        </ProForm>
        <Typography.Text type="secondary">这个页面抽象自站点、路由、策略、地址池/端口池配置的常见 ProFormField 组合。</Typography.Text>
      </Modal>
    </App>
  </ConfigProvider>;
}

createRoot(document.getElementById('root')!).render(<AntDProFormFieldsApp />);
