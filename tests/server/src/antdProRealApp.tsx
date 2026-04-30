/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Card, Form, Input, Modal, Select, Space, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ProCard, ProForm, ProFormText, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import 'antd/dist/reset.css';

interface ItemRecord {
  id: string;
  name: string;
  owner: string;
}

const initialItems: ItemRecord[] = [
  { id: 'item-001', name: 'item-seed', owner: '系统' },
];

function AntDProRealApp() {
  const [items, setItems] = React.useState<ItemRecord[]>(initialItems);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [selectedItem, setSelectedItem] = React.useState<string>();
  const [form] = Form.useForm();

  const columns: ProColumns<ItemRecord>[] = [
    { title: '条目名称', dataIndex: 'name' },
    { title: '负责人', dataIndex: 'owner' },
    {
      title: '操作',
      valueType: 'option',
      fixed: 'right',
      render: (_, record) => [
        <Button key="edit" type="link">编辑</Button>,
        <Button key="use" type="link" onClick={() => setSelectedItem(record.name)}>使用</Button>,
      ],
    },
  ];

  async function saveItem() {
    const values = await form.validateFields();
    setSaving(true);
    await new Promise(resolve => setTimeout(resolve, 850));
    const next: ItemRecord = {
      id: `item-${Date.now()}`,
      name: values.name,
      owner: values.owner || '运营',
    };
    setItems(current => [...current, next]);
    setSaving(false);
    setOpen(false);
    form.resetFields();
    message.success(`保存成功：${next.name}`);
  }

  return <div style={{ padding: 24 }}>
    <ProCard title="真实 AntD ProComponents 页面" bordered data-testid="real-pro-card">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="条目管理" data-testid="real-item-section">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)} data-testid="real-create-item">
            新建条目
          </Button>
          <div data-testid="real-items-table">
            <ProTable<ItemRecord>
              rowKey="id"
              search={false}
              options={false}
              pagination={false}
              columns={columns}
              dataSource={items}
              tableAlertRender={false}
            />
          </div>
        </Card>

        <ProForm submitter={false} layout="vertical" data-testid="real-downstream-form">
          <ProForm.Item label="下方表单使用条目" name="usedItem">
            <Select
              aria-label="下方表单使用条目"
              placeholder="选择刚保存的条目"
              value={selectedItem}
              onChange={setSelectedItem}
              options={items.map(item => ({ label: item.name, value: item.name }))}
              data-testid="real-used-item-select"
            />
          </ProForm.Item>
          <ProFormText name="remark" label="使用备注" placeholder="填写使用备注" />
        </ProForm>
      </Space>
    </ProCard>

    <Modal
      title="新建条目"
      open={open}
      confirmLoading={saving}
      onOk={saveItem}
      onCancel={() => setOpen(false)}
      okText="保存"
      cancelText="取消"
      data-testid="real-create-item-modal"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="条目名称" rules={[{ required: true, message: '请输入条目名称' }]}>
          <Input placeholder="请输入条目名称" />
        </Form.Item>
        <Form.Item name="owner" label="负责人">
          <Input placeholder="请输入负责人" />
        </Form.Item>
      </Form>
    </Modal>
  </div>;
}

createRoot(document.getElementById('root')!).render(<AntDProRealApp />);
