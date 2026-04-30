import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, Button, ConfigProvider, Form, Modal, Space, Table, Tag, Typography } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { PlusOutlined } from '@ant-design/icons';
import {
  ProCard,
  ProForm,
  ProFormCheckbox,
  ProFormDigit,
  ProFormRadio,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import 'antd/dist/reset.css';

type NetworkResource = {
  id: string;
  name: string;
  wan: string;
  poolType: string;
  arpProxy?: boolean;
  sourcePort?: number;
  remark?: string;
};

const wanOptions = [
  { label: 'edge-lab:WAN1', value: 'wan-1' },
  { label: 'edge-lab:WAN1-copy', value: 'wan-1-copy' },
  { label: 'edge-lab:WAN2', value: 'wan-2' },
  { label: 'edge-lab:WAN-disabled', value: 'wan-disabled', disabled: true },
  ...Array.from({ length: 36 }, (_, index) => ({ label: `edge-lab:WAN-extra-${index + 1}`, value: `wan-extra-${index + 1}` })),
];

const vrfOptions = [
  { label: '生产VRF', value: 'vrf-prod' },
  { label: '办公VRF', value: 'vrf-office' },
];

function AntDProFormFieldsApp() {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<NetworkResource[]>([]);
  const [form] = Form.useForm();

  const columns: ProColumns<NetworkResource>[] = [
    { title: '资源名称', dataIndex: 'name' },
    { title: 'WAN口', dataIndex: 'wan', render: (_, row) => <Tag color="blue">{row.wan}</Tag> },
    { title: '类型', dataIndex: 'poolType' },
    { title: '代理ARP', dataIndex: 'arpProxy', render: (_, row) => row.arpProxy ? '已开启' : '未开启' },
    { title: '备注', dataIndex: 'remark' },
  ];

  async function save() {
    const values = await form.validateFields();
    const wanLabel = wanOptions.find(option => option.value === values.wan)?.label || values.wan;
    const next: NetworkResource = {
      id: `network-resource-${Date.now()}`,
      name: values.name,
      wan: wanLabel,
      poolType: values.poolType,
      arpProxy: values.arpProxy,
      sourcePort: values.sourcePort,
      remark: values.remark,
    };
    setRows(current => [...current, next]);
    setOpen(false);
    form.resetFields();
  }

  return <ConfigProvider locale={zhCN}>
    <App>
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
          initialValues={{ poolType: 'shared', sourcePort: 443 }}
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
            } as any}
          />

          <ProFormCheckbox
            name="arpProxy"
            label="开启代理ARP"
            tooltip="抽象自网络资源配置页常见开关"
          />

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
