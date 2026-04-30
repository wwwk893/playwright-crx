/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Card, Form, Input, Modal, Select, Space, Table, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import 'antd/dist/reset.css';

interface UserRecord {
  id: string;
  username: string;
  role: string;
}

const initialUsers: UserRecord[] = [
  { id: 'user-41', username: 'Bob', role: '访客' },
  { id: 'user-42', username: 'Alice', role: '管理员' },
];

function AntDUsersRealApp() {
  const [users, setUsers] = React.useState<UserRecord[]>(initialUsers);
  const [open, setOpen] = React.useState(false);
  const [form] = Form.useForm();

  const columns: ColumnsType<UserRecord> = [
    { title: '用户名', dataIndex: 'username' },
    { title: '角色', dataIndex: 'role' },
    {
      title: '操作',
      fixed: 'right',
      render: (_, record) => <Button type="link">编辑</Button>,
    },
  ];

  async function saveUser() {
    const values = await form.validateFields();
    setUsers(current => [
      ...current,
      {
        id: `user-${Date.now()}`,
        username: values.username,
        role: values.role,
      },
    ]);
    setOpen(false);
    form.resetFields();
    message.success(`保存成功：${values.username}`);
  }

  return <div style={{ padding: 24 }}>
    <Card title="用户管理" data-testid="user-admin-card">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Button type="primary" icon={<PlusOutlined />} data-testid="create-user-btn" onClick={() => setOpen(true)}>
          新建用户
        </Button>
        <div data-testid="users-table">
          <Table<UserRecord>
            data-testid="users-table"
            rowKey="id"
            pagination={false}
            columns={columns}
            dataSource={users}
          />
        </div>
      </Space>
    </Card>

    <Modal
      title="新建用户"
      open={open}
      onCancel={() => setOpen(false)}
      footer={[
        <Button key="cancel" onClick={() => setOpen(false)}>取消</Button>,
        <Button key="ok" type="primary" data-testid="modal-confirm" onClick={saveUser}>确定</Button>,
      ]}
      data-testid="create-user-modal"
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ role: '管理员' }}>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
          <Input placeholder="请输入用户名" />
        </Form.Item>
        <Form.Item name="role" label="角色">
          <Select
            aria-label="角色"
            data-testid="role-select"
            options={[
              { label: '管理员', value: '管理员' },
              { label: '审计员', value: '审计员' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>;
}

createRoot(document.getElementById('root')!).render(<AntDUsersRealApp />);
