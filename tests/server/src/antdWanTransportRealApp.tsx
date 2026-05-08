import React from 'react';
import { createRoot } from 'react-dom/client';
import { Button, ConfigProvider, Modal, Popconfirm, Space, Tag } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { PlusOutlined } from '@ant-design/icons';
import { ProForm, ProFormDigit, ProFormRadio, ProFormSelect, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';

import 'antd/dist/reset.css';

interface TransportRecord {
  id: string;
  transport: string;
  tags: string[];
  fecMode: string;
  disableThreshold?: number;
}

const transportOptions = [
  { label: 'Nova 公网', value: 'nova_public' },
  { label: 'Nova 私网', value: 'nova_private' },
  { label: 'HS 公网', value: 'hs_public' },
  { label: 'HS 私网', value: 'hs_private' },
];

const tagOptions = [
  { label: 'controller', value: 'controller' },
  { label: 'business', value: 'business' },
  { label: 'backup', value: 'backup' },
];

const transportText = new Map(transportOptions.map(option => [option.value, option.label]));

function AntDWanTransportRealApp() {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [rows, setRows] = React.useState<TransportRecord[]>([
    { id: 'row-nova-public', transport: 'nova_public', tags: ['controller'], fecMode: 'off' },
  ]);
  const [form] = ProForm.useForm();

  const columns: ProColumns<TransportRecord>[] = [
    {
      title: '传输网络',
      dataIndex: 'transport',
      render: (_, record) => <Tag color="blue">{transportText.get(record.transport) || record.transport}</Tag>,
    },
    {
      title: 'WAN 标签',
      dataIndex: 'tags',
      render: (_, record) => <Space>{record.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</Space>,
    },
    {
      title: '操作',
      valueType: 'option',
      render: (_, record) => [
        <Button
          key="edit"
          type="link"
          data-testid="wan-transport-row-edit-action"
          data-e2e-component="pro-table"
          data-e2e-action="edit"
          onClick={() => {
            form.setFieldsValue({
              transport: record.transport,
              tags: record.tags,
              wanTransportFec: { enableEgressFec: record.fecMode },
              engressDisableThreshold: record.disableThreshold,
            });
            setModalOpen(true);
          }}
        >编辑</Button>,
        <Popconfirm
          key="delete"
          title="删除此行？"
          okText="确 定"
          cancelText="取 消"
          okButtonProps={{
            'data-testid': 'wan-transport-delete-confirm-ok',
            'data-e2e-component': 'popconfirm',
            'data-e2e-action': 'confirm',
          } as any}
          onConfirm={() => setRows(current => current.filter(row => row.id !== record.id))}
        >
          <Button
            type="link"
            danger
            data-testid="wan-transport-row-delete-action"
            data-e2e-component="pro-table"
            data-e2e-action="delete"
          >删除</Button>
        </Popconfirm>,
      ],
    },
  ];

  return <ConfigProvider locale={zhCN}>
    <main style={{ padding: 24 }}>
      <section data-testid="wan-transport-table" data-e2e-component="pro-table" data-e2e-table="wan-transport">
        <ProTable<TransportRecord>
          rowKey="transport"
          search={false}
          options={false}
          pagination={false}
          dataSource={rows}
          columns={columns}
          tableAlertRender={false}
          toolBarRender={() => [
            <Button
              key="add"
              type="primary"
              icon={<PlusOutlined />}
              data-testid="wan-transport-add-button"
              data-e2e-component="pro-table-toolbar"
              data-e2e-action="create"
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({
                  transport: 'nova_public',
                  tags: [],
                  wanTransportFec: { enableEgressFec: 'off' },
                });
                setModalOpen(true);
              }}
            >增加传输网络</Button>,
          ]}
        />
      </section>

      <Modal
        title="增加传输网络"
        open={modalOpen}
        okText="确 定"
        cancelText="取 消"
        okButtonProps={{
          'data-testid': 'wan-transport-modal-ok-button',
          'data-e2e-component': 'button',
          'data-e2e-action': 'submit',
          'data-e2e-form-kind': 'modal-form',
        } as any}
        cancelButtonProps={{
          'data-testid': 'wan-transport-modal-cancel-button',
          'data-e2e-component': 'button',
          'data-e2e-action': 'cancel',
          'data-e2e-form-kind': 'modal-form',
        } as any}
        data-testid="wan-transport-modal"
        data-e2e-overlay="modal"
        data-e2e-component="modal-form"
        onCancel={() => setModalOpen(false)}
        onOk={async () => {
          const values = await form.validateFields();
          setRows(current => [
            ...current.filter(row => row.transport !== values.transport),
            {
              id: `row-${values.transport}`,
              transport: values.transport,
              tags: values.tags || [],
              fecMode: values.wanTransportFec?.enableEgressFec || 'off',
              disableThreshold: values.engressDisableThreshold,
            },
          ]);
          setModalOpen(false);
        }}
      >
        <ProForm form={form} submitter={false} layout="vertical">
          <div
            data-testid="wan-transport-select-field"
            data-e2e-component="pro-form-field"
            data-e2e-field-name="transport"
            data-e2e-field-kind="select"
            data-e2e-form-kind="modal-form"
          >
            <ProFormSelect
              name="transport"
              label="传输网络"
              options={transportOptions}
              fieldProps={{
                'data-testid': 'wan-transport-select',
                'data-e2e-component': 'select',
                optionFilterProp: 'label',
              } as any}
            />
          </div>

          <div
            data-testid="wan-transport-tags-field"
            data-e2e-component="pro-form-field"
            data-e2e-field-name="tags"
            data-e2e-field-kind="multi-select"
            data-e2e-form-kind="modal-form"
          >
            <ProFormSelect
              name="tags"
              label="WAN 标签"
              mode="multiple"
              options={tagOptions}
              fieldProps={{
                'data-testid': 'wan-transport-tags-select',
                'data-e2e-component': 'select',
                optionFilterProp: 'label',
              } as any}
            />
          </div>

          <div
            data-testid="wan-transport-egress-fec-field"
            data-e2e-component="pro-form-field"
            data-e2e-field-name="wanTransportFec.enableEgressFec"
            data-e2e-field-kind="radio"
            data-e2e-form-kind="modal-form"
          >
            <ProFormRadio.Group
              name={['wanTransportFec', 'enableEgressFec']}
              label="出方向 FEC"
              options={[
                { label: '关闭', value: 'off' },
                { label: '自动', value: 'auto' },
              ]}
              fieldProps={{
                'data-testid': 'wan-transport-egress-fec-radio',
                'data-e2e-component': 'radio-group',
              } as any}
            />
          </div>

          <div
            data-testid="wan-transport-egress-disable-threshold-field"
            data-e2e-component="pro-form-field"
            data-e2e-field-name="wanTransportFec.engressThres.disableThres"
            data-e2e-field-kind="number"
            data-e2e-form-kind="modal-form"
          >
            <ProFormDigit
              name="engressDisableThreshold"
              label="小于该丢包率即关闭 FEC"
              fieldProps={{
                'data-testid': 'wan-transport-egress-disable-threshold-input',
                'data-e2e-component': 'input',
                'data-e2e-field-name': 'wanTransportFec.engressThres.disableThres',
                'data-e2e-field-kind': 'number',
              } as any}
            />
          </div>
        </ProForm>
      </Modal>
    </main>
  </ConfigProvider>;
}

createRoot(document.getElementById('root')!).render(<AntDWanTransportRealApp />);
